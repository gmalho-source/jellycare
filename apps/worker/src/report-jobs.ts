import { schema, type Database } from '@jellycare/db'
import {
  buildReport,
  monthPeriod,
  previousMonth,
  renderReportPdf,
  reportFileName,
  zonedYearMonth,
  type ReportData,
  type ReportPeriod,
} from '@jellycare/reports'
import { and, eq, gte, lt } from 'drizzle-orm'
import type { Browser } from 'playwright'

/**
 * Geração e envio dos relatórios mensais.
 *
 * Não passa pelo agendador de verificações: um relatório não é periódico em
 * minutos, é no dia N de cada mês. Esta rotina corre de hora a hora e pergunta
 * "que relatórios faltam?" — o índice único por site e período torna-a
 * idempotente, por isso correr de mais nunca duplica nada.
 */

export interface ReportJobDeps {
  db: Database
  browser?: () => Promise<Browser>
  /** Envio do email com o PDF anexado. */
  sendReport?: (message: ReportMessage) => Promise<void>
  timeZone?: string
  now?: Date
}

export interface ReportMessage {
  to: string[]
  subject: string
  text: string
  attachment: { filename: string; content: Buffer }
}

export type ReportOutcome =
  | { status: 'generated'; reportId: string; sentTo: string[] }
  | { status: 'skipped'; reason: string }

const DEFAULT_TIME_ZONE = 'Europe/Lisbon'

/** Dia do mês, no fuso do cliente. */
function zonedDayOfMonth(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, day: '2-digit' }).formatToParts(
    instant,
  )
  return Number(parts.find((entry) => entry.type === 'day')?.value)
}

function messageFor(data: ReportData, fileName: string, pdf: Buffer, to: string[]): ReportMessage {
  const lines = [
    `Olá,`,
    '',
    `Segue em anexo o relatório de ${data.period.label} do site ${data.site.label}.`,
    '',
    ...data.summary,
    '',
    'O relatório completo está no PDF em anexo.',
    '',
    `${data.brand.name} — ${data.brand.url}`,
  ]

  return {
    to,
    subject: `${data.site.label} — relatório de ${data.period.label}`,
    text: lines.join('\n'),
    attachment: { filename: fileName, content: pdf },
  }
}

/**
 * Gera o relatório de um período para um site.
 *
 * Devolve `skipped` quando o relatório já existe: é o caminho normal quando a
 * rotina corre de hora a hora, não um erro.
 */
export async function generateReport(
  deps: ReportJobDeps,
  siteId: string,
  period: ReportPeriod,
): Promise<ReportOutcome> {
  const { db } = deps

  const existing = await db
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.siteId, siteId),
        eq(schema.reports.periodYear, period.year),
        eq(schema.reports.periodMonth, period.month),
      ),
    )
    .limit(1)

  if (existing[0]) return { status: 'skipped', reason: 'Relatório já existe para este período' }

  const siteRows = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId))
    .limit(1)
  const site = siteRows[0]
  if (!site) return { status: 'skipped', reason: 'Site não encontrado' }

  const orgRows = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, site.organizationId))
    .limit(1)
  const organization = orgRows[0]
  if (!organization) return { status: 'skipped', reason: 'Organização não encontrada' }

  const [uptimeRows, findingRows, formRunRows, checkRunRows] = await Promise.all([
    db
      .select()
      .from(schema.uptimeSamples)
      .where(
        and(
          eq(schema.uptimeSamples.siteId, siteId),
          gte(schema.uptimeSamples.observedAt, period.start),
          lt(schema.uptimeSamples.observedAt, period.end),
        ),
      ),
    // Os findings não são filtrados por data: um problema aberto antes do
    // período e ainda em aberto tem de constar do relatório.
    db.select().from(schema.findings).where(eq(schema.findings.siteId, siteId)),
    db
      .select({
        startedAt: schema.formRuns.startedAt,
        submitted: schema.formRuns.submitted,
        emailReceived: schema.formRuns.emailReceived,
        deliveryLatencyMs: schema.formRuns.deliveryLatencyMs,
        landedInSpam: schema.formRuns.landedInSpam,
        formLabel: schema.forms.label,
      })
      .from(schema.formRuns)
      .innerJoin(schema.forms, eq(schema.forms.id, schema.formRuns.formId))
      .where(
        and(
          eq(schema.formRuns.siteId, siteId),
          gte(schema.formRuns.startedAt, period.start),
          lt(schema.formRuns.startedAt, period.end),
        ),
      ),
    db
      .select({
        checkType: schema.checkRuns.checkType,
        status: schema.checkRuns.status,
        startedAt: schema.checkRuns.startedAt,
      })
      .from(schema.checkRuns)
      .where(
        and(
          eq(schema.checkRuns.siteId, siteId),
          gte(schema.checkRuns.startedAt, period.start),
          lt(schema.checkRuns.startedAt, period.end),
        ),
      ),
  ])

  const data = buildReport({
    organizationName: organization.name,
    site: { label: site.label, url: site.url, hostname: site.hostname },
    period,
    slaTarget: site.slaTarget,
    uptimeSamples: uptimeRows.map((row) => ({
      observedAt: row.observedAt,
      up: row.up,
      failureReason: row.failureReason,
      responseTimeMs: row.responseTimeMs,
    })),
    findings: findingRows.map((row) => ({
      checkType: row.checkType,
      code: row.code,
      discriminator: row.discriminator,
      severity: row.severity,
      title: row.title,
      detail: row.detail,
      state: row.state,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      resolvedAt: row.resolvedAt,
    })),
    formRuns: formRunRows.map((row) => ({
      formLabel: row.formLabel,
      startedAt: row.startedAt,
      submitted: row.submitted,
      emailReceived: row.emailReceived,
      deliveryLatencyMs: row.deliveryLatencyMs,
      landedInSpam: row.landedInSpam,
    })),
    checkRuns: checkRunRows,
    ...(organization.brandName
      ? {
          brand: {
            name: organization.brandName,
            url: organization.brandUrl ?? 'https://jellycare.pt',
          },
        }
      : {}),
  })

  const pdf = await renderReportPdf(data, {
    ...(deps.browser ? { browser: await deps.browser() } : {}),
  })
  const fileName = reportFileName(data)

  const [inserted] = await db
    .insert(schema.reports)
    .values({
      siteId,
      periodYear: period.year,
      periodMonth: period.month,
      pdf,
      fileName,
      highlights: {
        summary: data.summary,
        uptimePercent: data.uptime.uptimePercent,
        slaMet: data.uptime.slaMet,
        incidents: data.uptime.incidents.length,
        findingsResolved: data.findings.resolved,
        findingsOpen: data.findings.stillOpen,
      },
      generatedAt: deps.now ?? new Date(),
    })
    // Duas instâncias de worker podem chegar aqui ao mesmo tempo. O índice
    // único decide, e quem perder não rebenta nem duplica.
    .onConflictDoNothing({
      target: [schema.reports.siteId, schema.reports.periodYear, schema.reports.periodMonth],
    })
    .returning({ id: schema.reports.id })

  if (!inserted) return { status: 'skipped', reason: 'Relatório gerado por outra instância' }

  const recipients = site.reportRecipients.filter((value) => value.includes('@'))
  if (recipients.length === 0 || !deps.sendReport) {
    return { status: 'generated', reportId: inserted.id, sentTo: [] }
  }

  try {
    await deps.sendReport(messageFor(data, fileName, pdf, recipients))
    await db
      .update(schema.reports)
      .set({ sentAt: deps.now ?? new Date(), sentTo: recipients })
      .where(eq(schema.reports.id, inserted.id))
    return { status: 'generated', reportId: inserted.id, sentTo: recipients }
  } catch (error) {
    // O relatório fica gerado e acessível no painel mesmo quando o email
    // falha; perder o relatório por causa do envio seria o pior dos dois.
    await db
      .update(schema.reports)
      .set({ sendError: error instanceof Error ? error.message : String(error) })
      .where(eq(schema.reports.id, inserted.id))
    return { status: 'generated', reportId: inserted.id, sentTo: [] }
  }
}

export interface ReportSweepResult {
  considered: number
  generated: number
  sent: number
}

/**
 * Passagem periódica: gera o que falta do mês anterior.
 *
 * Só depois do dia configurado, para dar tempo aos dados do fim do mês de
 * assentarem — nomeadamente à avaliação de entrega das últimas submissões.
 */
export async function generatePendingReports(
  deps: ReportJobDeps,
): Promise<ReportSweepResult> {
  const now = deps.now ?? new Date()
  const timeZone = deps.timeZone ?? DEFAULT_TIME_ZONE
  const period = previousMonth(now, timeZone)
  const today = zonedDayOfMonth(now, timeZone)

  const sites = await deps.db
    .select({
      id: schema.sites.id,
      organizationId: schema.sites.organizationId,
      sendDay: schema.organizations.reportSendDay,
      createdAt: schema.sites.createdAt,
    })
    .from(schema.sites)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.sites.organizationId))
    .where(eq(schema.sites.state, 'active'))

  let generated = 0
  let sent = 0

  for (const site of sites) {
    if (today < site.sendDay) continue
    // Um site criado a meio do período seguinte não tem mês anterior nenhum
    // para reportar.
    if (site.createdAt.getTime() >= period.end.getTime()) continue

    const outcome = await generateReport(deps, site.id, period)
    if (outcome.status === 'generated') {
      generated++
      if (outcome.sentTo.length > 0) sent++
    }
  }

  return { considered: sites.length, generated, sent }
}

/** Regenera o relatório de um período, para pedidos manuais a partir do painel. */
export async function regenerateReport(
  deps: ReportJobDeps,
  siteId: string,
  year: number,
  month: number,
): Promise<ReportOutcome> {
  const period = monthPeriod(year, month, deps.timeZone ?? DEFAULT_TIME_ZONE)

  await deps.db
    .delete(schema.reports)
    .where(
      and(
        eq(schema.reports.siteId, siteId),
        eq(schema.reports.periodYear, year),
        eq(schema.reports.periodMonth, month),
      ),
    )

  return generateReport(deps, siteId, period)
}

export { zonedYearMonth }
