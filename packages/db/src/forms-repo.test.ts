import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from './client.js'
import { recordCanaryDelivery, type CanaryDelivery } from './forms-repo.js'
import { formRuns, forms, organizations, sites } from './schema.js'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 4 })

let organizationId: string
let siteId: string
let formId: string

afterAll(async () => {
  if (organizationId) {
    await db.delete(organizations).where(eq(organizations.id, organizationId))
  }
  await close()
})

beforeEach(async () => {
  if (organizationId) {
    await db.delete(organizations).where(eq(organizations.id, organizationId))
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Cliente', slug: `entrega-${Date.now()}-${Math.random()}` })
    .returning({ id: organizations.id })
  organizationId = org!.id

  const [site] = await db
    .insert(sites)
    .values({
      organizationId,
      label: 'Site',
      url: 'https://cliente.pt',
      hostname: 'cliente.pt',
      state: 'active',
    })
    .returning({ id: sites.id })
  siteId = site!.id

  const [form] = await db
    .insert(forms)
    .values({
      siteId,
      label: 'Contacto',
      pageUrl: 'https://cliente.pt/contactos',
      selector: '#contacto',
    })
    .returning({ id: forms.id })
  formId = form!.id
})

async function submission(token: string, startedAt = new Date(Date.now() - 60_000)) {
  await db.insert(formRuns).values({
    formId,
    siteId,
    canaryToken: token,
    canaryAddress: `check+x-${token}@check.jellycare.pt`,
    startedAt,
    submitted: true,
  })
}

function delivery(token: string, overrides: Partial<CanaryDelivery> = {}): CanaryDelivery {
  return {
    token,
    receivedAt: new Date(),
    latencyMs: 12_000,
    spf: 'pass',
    dkim: 'pass',
    dmarc: 'pass',
    landedInSpam: false,
    ...overrides,
  }
}

describe('recordCanaryDelivery', () => {
  it('regista a chegada com latência e autenticação', async () => {
    await submission('tok-1')

    const outcome = await recordCanaryDelivery(db, delivery('tok-1'))
    expect(outcome).toMatchObject({ status: 'recorded', siteId })

    const [run] = await db.select().from(formRuns).where(eq(formRuns.canaryToken, 'tok-1'))
    expect(run).toMatchObject({
      emailReceived: true,
      deliveryLatencyMs: 12_000,
      spf: 'pass',
      landedInSpam: false,
    })
  })

  it('não conhece um token que não é nosso', async () => {
    expect(await recordCanaryDelivery(db, delivery('inventado'))).toEqual({
      status: 'unknown_token',
    })
  })

  it('a segunda entrega do mesmo email não sobrepõe a primeira', async () => {
    await submission('tok-2')
    await recordCanaryDelivery(db, delivery('tok-2', { latencyMs: 5_000 }))

    const repetida = await recordCanaryDelivery(db, delivery('tok-2', { latencyMs: 900_000 }))
    expect(repetida.status).toBe('already_recorded')

    // Os fornecedores repetem entregas quando não recebem 2xx a tempo. A
    // latência que vale é a da primeira chegada.
    const [run] = await db.select().from(formRuns).where(eq(formRuns.canaryToken, 'tok-2'))
    expect(run?.deliveryLatencyMs).toBe(5_000)
  })

  it('duas entregas simultâneas só escrevem uma vez', async () => {
    await submission('tok-3')

    const [a, b] = await Promise.all([
      recordCanaryDelivery(db, delivery('tok-3', { latencyMs: 4_000 })),
      recordCanaryDelivery(db, delivery('tok-3', { latencyMs: 8_000 })),
    ])

    const outcomes = [a.status, b.status].sort()
    expect(outcomes).toEqual(['already_recorded', 'recorded'])
  })

  it('guarda a classificação de spam quando o fornecedor a dá', async () => {
    await submission('tok-4')
    await recordCanaryDelivery(db, delivery('tok-4', { landedInSpam: true, spf: 'fail' }))

    const [run] = await db.select().from(formRuns).where(eq(formRuns.canaryToken, 'tok-4'))
    expect(run?.landedInSpam).toBe(true)
    expect(run?.spf).toBe('fail')
  })

  it('aceita autenticação desconhecida sem rebentar', async () => {
    await submission('tok-5')
    const outcome = await recordCanaryDelivery(
      db,
      delivery('tok-5', { spf: null, dkim: null, dmarc: null, landedInSpam: null }),
    )

    expect(outcome.status).toBe('recorded')
    const [run] = await db.select().from(formRuns).where(eq(formRuns.canaryToken, 'tok-5'))
    expect(run?.spf).toBeNull()
    expect(run?.landedInSpam).toBeNull()
  })
})
