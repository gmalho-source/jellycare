import type { CheckOutcome, ObservedFinding } from '@jellycare/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from './client.js'
import { recordCheckRun } from './findings-repo.js'
import { checkRuns, findings, organizations, sites } from './schema.js'

/**
 * Testes de integração contra Postgres real. A reconciliação já está coberta
 * em memória no @jellycare/core; o que se verifica aqui é a fronteira que os
 * testes unitários não alcançam — transações, o índice único do fingerprint e
 * a tradução entre `undefined` e `NULL`.
 */
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 4 })

let siteId: string

afterAll(async () => {
  await close()
})

beforeEach(async () => {
  await db.delete(organizations)
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Cliente Teste', slug: `cliente-${Date.now()}-${Math.random()}` })
    .returning({ id: organizations.id })
  const [site] = await db
    .insert(sites)
    .values({
      organizationId: org!.id,
      label: 'Site do cliente',
      url: 'https://cliente.pt',
      hostname: 'cliente.pt',
      state: 'active',
    })
    .returning({ id: sites.id })
  siteId = site!.id
})

function outcome(
  observedFindings: ObservedFinding[],
  status: CheckOutcome['status'] = 'ok',
): CheckOutcome {
  return { status, findings: observedFindings, metrics: { pagesCrawled: 12 }, durationMs: 400 }
}

const brokenLink: ObservedFinding = {
  code: 'link_broken',
  discriminator: 'https://cliente.pt/sobre',
  severity: 'medium',
  title: 'Link quebrado: /sobre',
  detail: 'HTTP 404',
  evidence: { foundOn: 'https://cliente.pt/', anchorText: 'Sobre nós' },
}

async function run(
  observedFindings: ObservedFinding[],
  options: { status?: CheckOutcome['status']; confirmationsRequired?: number; now?: Date } = {},
) {
  return recordCheckRun(db, {
    siteId,
    checkType: 'broken_links',
    outcome: outcome(observedFindings, options.status),
    confirmationsRequired: options.confirmationsRequired ?? 1,
    startedAt: options.now ?? new Date(),
    now: options.now ?? new Date(),
  })
}

async function findingRows() {
  return db.select().from(findings).where(eq(findings.siteId, siteId))
}

describe('recordCheckRun', () => {
  it('regista o run com as métricas e cria o finding', async () => {
    const { runId, notifications } = await run([brokenLink])

    const runs = await db.select().from(checkRuns).where(eq(checkRuns.id, runId))
    expect(runs[0]?.status).toBe('ok')
    expect(runs[0]?.metrics).toEqual({ pagesCrawled: 12 })

    const rows = await findingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.state).toBe('open')
    expect(rows[0]?.evidence).toEqual({
      foundOn: 'https://cliente.pt/',
      anchorText: 'Sobre nós',
    })
    expect(notifications).toHaveLength(1)
  })

  it('não cria duplicados quando o mesmo problema persiste entre runs', async () => {
    await run([brokenLink])
    const second = await run([brokenLink])

    const rows = await findingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.occurrences).toBe(2)
    expect(second.notifications).toHaveLength(0)
  })

  it('resolve o finding quando o problema desaparece e reabre quando volta', async () => {
    await run([brokenLink])
    await run([])

    let rows = await findingRows()
    expect(rows[0]?.state).toBe('resolved')
    expect(rows[0]?.resolvedAt).not.toBeNull()

    const reopened = await run([brokenLink])
    rows = await findingRows()
    expect(rows[0]?.state).toBe('open')
    // A data de resolução tem de ser limpa, senão o relatório mensal conta o
    // problema como resolvido enquanto ele continua aberto.
    expect(rows[0]?.resolvedAt).toBeNull()
    expect(reopened.notifications[0]?.kind).toBe('reopened')
  })

  it('um run falhado regista o erro e não resolve nada', async () => {
    await run([brokenLink])

    const failed = await recordCheckRun(db, {
      siteId,
      checkType: 'broken_links',
      outcome: {
        status: 'failed',
        findings: [],
        metrics: {},
        error: 'ETIMEDOUT',
        durationMs: 30_000,
      },
      startedAt: new Date(),
    })

    const runs = await db.select().from(checkRuns).where(eq(checkRuns.id, failed.runId))
    expect(runs[0]?.status).toBe('failed')
    expect(runs[0]?.error).toBe('ETIMEDOUT')

    const rows = await findingRows()
    expect(rows[0]?.state).toBe('open')
    expect(rows[0]?.resolvedAt).toBeNull()
  })

  it('isola findings de check types diferentes no mesmo site', async () => {
    await run([brokenLink])

    // Um run de SSL sem problemas não pode resolver os links quebrados.
    await recordCheckRun(db, {
      siteId,
      checkType: 'ssl',
      outcome: outcome([]),
      startedAt: new Date(),
    })

    const rows = await findingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.state).toBe('open')
  })

  it('o índice único impede duplicados quando dois runs correm em paralelo', async () => {
    const [a, b] = await Promise.all([run([brokenLink]), run([brokenLink])])

    const rows = await findingRows()
    expect(rows).toHaveLength(1)
    // Ambos os runs ficam registados, mesmo tendo corrido em corrida.
    expect(a.runId).not.toBe(b.runId)
  })

  it('respeita a confirmação: o finding fica pendente e só notifica ao segundo run', async () => {
    const first = await run([brokenLink], { confirmationsRequired: 2 })
    expect(first.notifications).toHaveLength(0)
    let rows = await findingRows()
    expect(rows[0]?.state).toBe('pending')

    const second = await run([brokenLink], { confirmationsRequired: 2 })
    rows = await findingRows()
    expect(rows[0]?.state).toBe('open')
    expect(second.notifications[0]?.kind).toBe('opened')
  })

  it('persiste a severidade agravada e notifica', async () => {
    await run([brokenLink])
    const escalated = await run([{ ...brokenLink, severity: 'critical' }])

    const rows = await findingRows()
    expect(rows[0]?.severity).toBe('critical')
    expect(escalated.notifications[0]?.kind).toBe('escalated')
    expect(escalated.notifications[0]?.previousSeverity).toBe('medium')
  })
})
