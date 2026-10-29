import type { CheckOutcome, ObservedFinding } from '@jellycare/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { lerAtividade, registarAtividade } from './atividade.js'
import { createDatabase } from './client.js'
import { recordCheckRun } from './findings-repo.js'
import { organizations, sites, users } from './schema.js'

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 4 })

let siteId: string
let organizationId: string
let userId: string

afterAll(async () => {
  if (organizationId) await db.delete(organizations).where(eq(organizations.id, organizationId))
  if (userId) await db.delete(users).where(eq(users.id, userId))
  await close()
})

beforeEach(async () => {
  if (organizationId) await db.delete(organizations).where(eq(organizations.id, organizationId))
  const marca = `${Date.now()}-${Math.random()}`
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Cliente Atividade', slug: `atividade-${marca}` })
    .returning({ id: organizations.id })
  organizationId = org!.id
  const [site] = await db
    .insert(sites)
    .values({ organizationId, label: 'Site', url: 'https://cliente.pt', hostname: 'cliente.pt', state: 'active' })
    .returning({ id: sites.id })
  siteId = site!.id
  if (!userId) {
    const [user] = await db
      .insert(users)
      .values({ email: `equipa-${marca}@jelly.pt`, name: 'Ana Equipa' })
      .returning({ id: users.id })
    userId = user!.id
  }
})

const HSTS: ObservedFinding = { code: 'missing_hsts', severity: 'medium', title: 'Falta o HSTS' }

function run(observed: ObservedFinding[], minutos: number, confirmationsRequired = 1) {
  const now = new Date(Date.UTC(2026, 9, 1, 10, minutos))
  const outcome: CheckOutcome = { status: 'ok', findings: observed, metrics: {}, durationMs: 10 }
  return recordCheckRun(db, { siteId, checkType: 'security_headers', outcome, confirmationsRequired, startedAt: now, now })
}

async function tipos() {
  const linhas = await lerAtividade(db, { siteIds: [siteId], incluirInternos: true })
  return linhas.map((linha) => linha.tipo).reverse()
}

describe('registo de atividade', () => {
  it('guarda o caminho de um problema: detetado, resolvido, reapareceu, resolvido', async () => {
    await run([HSTS], 0)
    await run([], 1)
    await run([HSTS], 2)
    await run([], 3)

    expect(await tipos()).toEqual([
      'problema_detetado',
      'problema_resolvido',
      'problema_reapareceu',
      'problema_resolvido',
    ])
    const [ultima] = await lerAtividade(db, { siteIds: [siteId], incluirInternos: true, limite: 1 })
    expect(ultima?.dados).toMatchObject({ titulo: 'Falta o HSTS', codigo: 'missing_hsts', severidade: 'medium' })
    expect(ultima?.findingId).not.toBeNull()
    expect(ultima?.autor).toBeNull()
  })

  it('um problema que volta e precisa de confirmação conta como reaparecido, não como novo', async () => {
    await run([HSTS], 0, 2)
    await run([HSTS], 1, 2)
    await run([], 2, 2)
    await run([HSTS], 3, 2)
    await run([HSTS], 4, 2)

    expect(await tipos()).toEqual(['problema_detetado', 'problema_resolvido', 'problema_reapareceu'])
  })

  it('esconde da vista do cliente o que é só da equipa', async () => {
    await run([HSTS], 0)
    await registarAtividade(db, {
      siteId,
      tipo: 'problema_silenciado',
      actorId: userId,
      dados: { titulo: 'Falta o HSTS' },
    })

    const equipa = await lerAtividade(db, { siteIds: [siteId], incluirInternos: true })
    expect(equipa.map((l) => l.tipo)).toContain('problema_silenciado')
    expect(equipa.find((l) => l.tipo === 'problema_silenciado')?.autor).toEqual({
      nome: 'Ana Equipa',
      email: expect.stringContaining('@jelly.pt'),
    })

    const cliente = await lerAtividade(db, { siteIds: [siteId], incluirInternos: false })
    expect(cliente.map((l) => l.tipo)).toEqual(['problema_detetado'])
  })

  it('filtra por período e por tipo, e não devolve nada para uma lista de sites vazia', async () => {
    await run([HSTS], 0)
    await run([], 30)

    const resolvidos = await lerAtividade(db, {
      siteIds: [siteId],
      tipos: ['problema_resolvido'],
      incluirInternos: true,
    })
    expect(resolvidos).toHaveLength(1)

    const antes = await lerAtividade(db, {
      siteIds: [siteId],
      incluirInternos: true,
      ate: new Date(Date.UTC(2026, 9, 1, 10, 15)),
    })
    expect(antes.map((l) => l.tipo)).toEqual(['problema_detetado'])

    expect(await lerAtividade(db, { siteIds: [], incluirInternos: true })).toEqual([])
  })
})
