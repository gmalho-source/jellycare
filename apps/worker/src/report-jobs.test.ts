import { createDatabase, schema } from '@jellycare/db'
import { monthPeriod } from '@jellycare/reports'
import { existsSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBrowserPool } from './browser-pool.js'
import {
  generatePendingReports,
  generateReport,
  regenerateReport,
  type ReportMessage,
} from './report-jobs.js'

/**
 * Geração e envio dos relatórios, contra Postgres e browser reais.
 *
 * O que interessa verificar aqui é o ciclo de vida: que a rotina pode correr
 * de hora a hora sem duplicar, que o relatório sobrevive a uma falha de envio,
 * e que os números que chegam ao cliente saem mesmo dos dados do período.
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 4 })

const TIME_ZONE = 'Europe/Lisbon'
const PERIOD = monthPeriod(2026, 6, TIME_ZONE)
const INTERVAL = 5 * 60_000
/** Dia 5 de julho: já passou o dia de envio configurado. */
const DEPOIS_DO_PERIODO = new Date('2026-07-05T09:00:00Z')

const pool = createBrowserPool(
  existsSync('/opt/pw-browsers/chromium')
    ? { executablePath: '/opt/pw-browsers/chromium', noSandbox: true }
    : { noSandbox: true },
)

let organizationId: string
let siteId: string
let sent: ReportMessage[] = []

const deps = (overrides: Record<string, unknown> = {}) => ({
  db,
  browser: pool.get,
  timeZone: TIME_ZONE,
  now: DEPOIS_DO_PERIODO,
  sendReport: async (message: ReportMessage) => {
    sent.push(message)
  },
  ...overrides,
})

beforeEach(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  sent = []

  const [org] = await db
    .insert(schema.organizations)
    .values({
      name: 'Cliente Relatório',
      slug: `relatorio-${Date.now()}-${Math.random()}`,
      reportSendDay: 3,
    })
    .returning({ id: schema.organizations.id })
  organizationId = org!.id

  const [site] = await db
    .insert(schema.sites)
    .values({
      organizationId,
      label: 'Site do cliente',
      url: 'https://cliente.pt',
      hostname: 'cliente.pt',
      state: 'active',
      slaTarget: 99.9,
      reportRecipients: ['cliente@exemplo.pt'],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    .returning({ id: schema.sites.id })
  siteId = site!.id
})

afterAll(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  await pool.close()
  await close()
})

/** Amostras de disponibilidade cobrindo o período, com uma interrupção opcional. */
async function seedUptime(downFrom = -1, downTo = -1) {
  const total = Math.round((PERIOD.end.getTime() - PERIOD.start.getTime()) / INTERVAL)
  const rows = Array.from({ length: total }, (_, index) => {
    const down = index >= downFrom && index <= downTo
    return {
      siteId,
      region: 'eu-west',
      observedAt: new Date(PERIOD.start.getTime() + index * INTERVAL),
      up: !down,
      statusCode: down ? 503 : 200,
      responseTimeMs: down ? null : 200,
      failureReason: down ? 'HTTP 503' : null,
    }
  })

  // Em lotes: oito mil linhas numa só instrução esbarram no limite de
  // parâmetros do Postgres.
  for (let index = 0; index < rows.length; index += 1000) {
    await db.insert(schema.uptimeSamples).values(rows.slice(index, index + 1000))
  }
}

async function storedReports() {
  return db.select().from(schema.reports).where(eq(schema.reports.siteId, siteId))
}

describe('generateReport', () => {
  it('gera o relatório com PDF e números do período', async () => {
    await seedUptime(100, 130)

    const outcome = await generateReport(deps(), siteId, PERIOD)
    expect(outcome.status).toBe('generated')

    const [report] = await storedReports()
    expect(report?.periodYear).toBe(2026)
    expect(report?.periodMonth).toBe(6)
    expect(report?.fileName).toBe('jellycare-cliente-pt-2026-06.pdf')
    expect(report?.pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(report?.highlights.incidents).toBe(1)
    expect(report?.highlights.uptimePercent).toBeLessThan(100)
  }, 120_000)

  it('envia por email aos destinatários configurados, com o PDF anexado', async () => {
    await seedUptime()

    await generateReport(deps(), siteId, PERIOD)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toEqual(['cliente@exemplo.pt'])
    expect(sent[0]?.subject).toContain('junho de 2026')
    expect(sent[0]?.attachment.content.subarray(0, 5).toString()).toBe('%PDF-')

    const [report] = await storedReports()
    expect(report?.sentAt).not.toBeNull()
    expect(report?.sentTo).toEqual(['cliente@exemplo.pt'])
  }, 120_000)

  it('não gera duas vezes o mesmo período', async () => {
    await seedUptime()

    await generateReport(deps(), siteId, PERIOD)
    const segunda = await generateReport(deps(), siteId, PERIOD)

    expect(segunda).toMatchObject({ status: 'skipped' })
    expect(await storedReports()).toHaveLength(1)
    expect(sent).toHaveLength(1)
  }, 120_000)

  it('guarda o relatório mesmo quando o envio falha', async () => {
    await seedUptime()

    const outcome = await generateReport(
      deps({
        sendReport: async () => {
          throw new Error('Resend respondeu 500')
        },
      }),
      siteId,
      PERIOD,
    )

    // Perder o relatório por causa do email seria o pior dos dois males: fica
    // gerado e acessível no painel, com o erro registado.
    expect(outcome).toMatchObject({ status: 'generated', sentTo: [] })
    const [report] = await storedReports()
    expect(report?.sendError).toContain('500')
    expect(report?.sentAt).toBeNull()
  }, 120_000)

  it('gera sem enviar quando não há destinatários', async () => {
    await seedUptime()
    await db.update(schema.sites).set({ reportRecipients: [] }).where(eq(schema.sites.id, siteId))

    const outcome = await generateReport(deps(), siteId, PERIOD)

    expect(outcome).toMatchObject({ status: 'generated', sentTo: [] })
    expect(sent).toHaveLength(0)
  }, 120_000)

  it('usa a marca da organização no relatório white-label', async () => {
    await seedUptime()
    await db
      .update(schema.organizations)
      .set({ brandName: 'Estúdio X', brandUrl: 'https://estudiox.pt' })
      .where(eq(schema.organizations.id, organizationId))

    await generateReport(deps(), siteId, PERIOD)

    expect(sent[0]?.text).toContain('Estúdio X')
  }, 120_000)

  it('respeita o SLA configurado no site', async () => {
    // Uma interrupção de 31 amostras em ~8900 fica abaixo de 99,9%.
    await seedUptime(100, 130)
    await db.update(schema.sites).set({ slaTarget: 99.9 }).where(eq(schema.sites.id, siteId))

    await generateReport(deps(), siteId, PERIOD)
    const [report] = await storedReports()

    expect(report?.highlights.slaMet).toBe(false)
  }, 120_000)
})

describe('generatePendingReports', () => {
  it('gera o relatório do mês anterior depois do dia configurado', async () => {
    await seedUptime()

    const result = await generatePendingReports(deps())

    expect(result.generated).toBe(1)
    expect(result.sent).toBe(1)
    const [report] = await storedReports()
    expect(report?.periodMonth).toBe(6)
  }, 120_000)

  it('espera pelo dia de envio configurado', async () => {
    await seedUptime()

    // Dia 2 de julho, com envio configurado para o dia 3.
    const result = await generatePendingReports(
      deps({ now: new Date('2026-07-02T09:00:00Z') }),
    )

    expect(result.generated).toBe(0)
    expect(await storedReports()).toHaveLength(0)
  }, 120_000)

  it('é idempotente: correr de hora a hora não duplica', async () => {
    await seedUptime()

    await generatePendingReports(deps())
    const segunda = await generatePendingReports(deps())

    expect(segunda.generated).toBe(0)
    expect(await storedReports()).toHaveLength(1)
  }, 120_000)

  it('ignora sites que não estão ativos', async () => {
    await seedUptime()
    await db.update(schema.sites).set({ state: 'paused' }).where(eq(schema.sites.id, siteId))

    const result = await generatePendingReports(deps())
    expect(result.generated).toBe(0)
  }, 120_000)

  it('ignora sites criados depois do período', async () => {
    // Um site adicionado em julho não tem junho para reportar.
    await db
      .update(schema.sites)
      .set({ createdAt: new Date('2026-07-01T12:00:00Z') })
      .where(eq(schema.sites.id, siteId))

    const result = await generatePendingReports(deps())
    expect(result.generated).toBe(0)
  }, 120_000)

  it('gera relatório mesmo num mês sem dados nenhuns', async () => {
    const result = await generatePendingReports(deps())

    // O silêncio também é informação: o cliente recebe o relatório a dizer que
    // não houve observações, em vez de não receber nada e ficar sem saber.
    expect(result.generated).toBe(1)
    const [report] = await storedReports()
    expect(report?.highlights.uptimePercent).toBeNull()
    expect(report?.highlights.summary[0]).toContain('Não houve observações')
  }, 120_000)
})

describe('regenerateReport', () => {
  it('substitui um relatório já gerado', async () => {
    await seedUptime()
    await generateReport(deps(), siteId, PERIOD)
    const [primeiro] = await storedReports()

    const outcome = await regenerateReport(deps(), siteId, 2026, 6)

    expect(outcome.status).toBe('generated')
    const reports = await storedReports()
    expect(reports).toHaveLength(1)
    expect(reports[0]?.id).not.toBe(primeiro?.id)
  }, 120_000)

  it('não toca em relatórios de outros períodos', async () => {
    await seedUptime()
    await generateReport(deps(), siteId, PERIOD)
    await generateReport(deps(), siteId, monthPeriod(2026, 5, TIME_ZONE))

    await regenerateReport(deps(), siteId, 2026, 6)

    const maio = await db
      .select()
      .from(schema.reports)
      .where(and(eq(schema.reports.siteId, siteId), eq(schema.reports.periodMonth, 5)))
    expect(maio).toHaveLength(1)
  }, 180_000)
})
