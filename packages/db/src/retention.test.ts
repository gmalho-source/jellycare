import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from './client.js'
import { applyRetention, countStoredScreenshots, DEFAULT_RETENTION } from './retention.js'
import {
  checkRuns,
  findings,
  forms,
  formRuns,
  organizations,
  reports,
  sessions,
  sites,
  uptimeSamples,
  users,
} from './schema.js'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

const AGORA = new Date('2026-09-18T12:00:00Z')
const HA_100_DIAS = new Date(AGORA.getTime() - 100 * 24 * 3600_000)
const HA_10_DIAS = new Date(AGORA.getTime() - 10 * 24 * 3600_000)
const HA_3_ANOS = new Date('2023-09-18T12:00:00Z')
const HA_1_ANO = new Date('2025-09-18T12:00:00Z')

let organizationId: string
let siteId: string

beforeEach(async () => {
  if (organizationId) {
    await db.delete(organizations).where(eq(organizations.id, organizationId))
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Retenção', slug: `retencao-${Date.now()}-${Math.random()}` })
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
})

afterAll(async () => {
  if (organizationId) {
    await db.delete(organizations).where(eq(organizations.id, organizationId))
  }
  await close()
})

async function contar(tabela: typeof checkRuns | typeof uptimeSamples | typeof formRuns) {
  const rows = await db.select().from(tabela).where(eq(tabela.siteId, siteId))
  return rows.length
}

describe('applyRetention', () => {
  it('apaga execuções antigas e mantém as recentes', async () => {
    await db.insert(checkRuns).values([
      { siteId, checkType: 'uptime', status: 'ok', startedAt: HA_100_DIAS, durationMs: 100 },
      { siteId, checkType: 'uptime', status: 'ok', startedAt: HA_10_DIAS, durationMs: 100 },
    ])

    const resultado = await applyRetention(db, DEFAULT_RETENTION, AGORA)

    expect(resultado.checkRuns).toBeGreaterThanOrEqual(1)
    expect(await contar(checkRuns)).toBe(1)
  })

  it('apaga amostras de disponibilidade antigas', async () => {
    await db.insert(uptimeSamples).values([
      { siteId, region: 'eu-west', observedAt: HA_100_DIAS, up: true },
      { siteId, region: 'eu-west', observedAt: HA_10_DIAS, up: true },
    ])

    await applyRetention(db, DEFAULT_RETENTION, AGORA)

    expect(await contar(uptimeSamples)).toBe(1)
  })

  it('apaga submissões de formulário antigas, que guardam o endereço canário', async () => {
    const [form] = await db
      .insert(forms)
      .values({ siteId, label: 'Contacto', pageUrl: 'https://cliente.pt/c', selector: '#f' })
      .returning({ id: forms.id })

    await db.insert(formRuns).values([
      {
        formId: form!.id,
        siteId,
        canaryToken: `t1-${Date.now()}`,
        canaryAddress: 'check+antigo@check.jellycare.pt',
        startedAt: HA_100_DIAS,
      },
      {
        formId: form!.id,
        siteId,
        canaryToken: `t2-${Date.now()}`,
        canaryAddress: 'check+recente@check.jellycare.pt',
        startedAt: HA_10_DIAS,
      },
    ])

    await applyRetention(db, DEFAULT_RETENTION, AGORA)

    expect(await contar(formRuns)).toBe(1)
  })

  it('nunca apaga um problema em aberto, por muito antigo que seja', async () => {
    // Um problema por resolver continua a ser verdade. Apagá-lo por idade
    // fazia a plataforma esquecer-se de uma coisa que ainda está errada.
    await db.insert(findings).values({
      siteId,
      checkType: 'security_headers',
      fingerprint: `aberto-${Date.now()}`,
      code: 'missing_csp',
      severity: 'low',
      state: 'open',
      title: 'Sem CSP',
      firstSeenAt: HA_3_ANOS,
      lastSeenAt: HA_3_ANOS,
    })

    await applyRetention(db, DEFAULT_RETENTION, AGORA)

    const restantes = await db.select().from(findings).where(eq(findings.siteId, siteId))
    expect(restantes).toHaveLength(1)
  })

  it('apaga um problema resolvido há mais de dois anos', async () => {
    await db.insert(findings).values([
      {
        siteId,
        checkType: 'tls',
        fingerprint: `velho-${Date.now()}`,
        code: 'cert_expiring',
        severity: 'medium',
        state: 'resolved',
        title: 'Certificado a expirar',
        firstSeenAt: HA_3_ANOS,
        lastSeenAt: HA_3_ANOS,
        resolvedAt: HA_3_ANOS,
      },
      {
        siteId,
        checkType: 'tls',
        fingerprint: `recente-${Date.now()}`,
        code: 'cert_expiring',
        severity: 'medium',
        state: 'resolved',
        title: 'Certificado a expirar',
        firstSeenAt: HA_1_ANO,
        lastSeenAt: HA_1_ANO,
        resolvedAt: HA_1_ANO,
      },
    ])

    await applyRetention(db, DEFAULT_RETENTION, AGORA)

    const restantes = await db
      .select()
      .from(findings)
      .where(and(eq(findings.siteId, siteId), eq(findings.state, 'resolved')))
    expect(restantes).toHaveLength(1)
  })

  it('mantém os relatórios dentro dos dois anos e apaga os anteriores', async () => {
    const pdf = Buffer.from('%PDF-1.4 teste')
    const highlights = {
      summary: [],
      uptimePercent: null,
      slaMet: null,
      incidents: 0,
      findingsResolved: 0,
      findingsOpen: 0,
    }

    await db.insert(reports).values([
      {
        siteId,
        periodYear: 2023,
        periodMonth: 8,
        generatedAt: HA_3_ANOS,
        pdf,
        fileName: 'velho.pdf',
        highlights,
      },
      {
        siteId,
        periodYear: 2025,
        periodMonth: 8,
        generatedAt: HA_1_ANO,
        pdf,
        fileName: 'recente.pdf',
        highlights,
      },
    ])

    await applyRetention(db, DEFAULT_RETENTION, AGORA)

    const restantes = await db.select().from(reports).where(eq(reports.siteId, siteId))
    expect(restantes.map((r) => r.fileName)).toEqual(['recente.pdf'])
  })

  it('apaga sessões caducadas', async () => {
    const [utilizador] = await db
      .insert(users)
      .values({ email: `retencao-${Date.now()}@exemplo.pt` })
      .returning({ id: users.id })

    await db.insert(sessions).values([
      { userId: utilizador!.id, tokenHash: `caducada-${Date.now()}`, expiresAt: HA_10_DIAS },
      {
        userId: utilizador!.id,
        tokenHash: `viva-${Date.now()}`,
        expiresAt: new Date(AGORA.getTime() + 24 * 3600_000),
      },
    ])

    await applyRetention(db, DEFAULT_RETENTION, AGORA)

    const restantes = await db.select().from(sessions).where(eq(sessions.userId, utilizador!.id))
    expect(restantes).toHaveLength(1)

    await db.delete(users).where(eq(users.id, utilizador!.id))
  })

  it('correr duas vezes não apaga nada de novo', async () => {
    await db.insert(checkRuns).values({
      siteId,
      checkType: 'uptime',
      status: 'ok',
      startedAt: HA_100_DIAS,
      durationMs: 100,
    })

    await applyRetention(db, DEFAULT_RETENTION, AGORA)
    const segunda = await applyRetention(db, DEFAULT_RETENTION, AGORA)

    expect(segunda.checkRuns).toBe(0)
  })
})

describe('screenshots', () => {
  it('não há capturas guardadas para apagar', async () => {
    // A política prevê trinta dias para screenshots. Hoje não são guardadas em
    // lado nenhum, e este teste é o alarme: no dia em que alguém as começar a
    // guardar sem acrescentar a limpeza, falha aqui.
    expect(await countStoredScreenshots(db)).toBe(0)
  })
})
