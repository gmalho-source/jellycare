import { severityRank, type Severity } from '@jellycare/core'
import type { ReportPeriod } from './period.js'
import { summariseUptime, type UptimeSample, type UptimeSummary } from './uptime.js'

/**
 * Montagem do relatório mensal.
 *
 * Recebe linhas cruas e devolve o relatório pronto a renderizar, sem tocar na
 * base de dados: é o que permite testá-lo contra cenários que seriam penosos
 * de montar em SQL — um mês sem monitorização, um SLA falhado por pouco, um
 * formulário que deixou de entregar a meio do mês.
 */

export interface ReportFinding {
  checkType: string
  code: string
  discriminator?: string | null
  severity: Severity
  title: string
  detail?: string | null
  state: string
  firstSeenAt: Date
  lastSeenAt: Date
  resolvedAt?: Date | null
}

export interface ReportFormRun {
  formLabel: string
  startedAt: Date
  submitted: boolean
  emailReceived: boolean
  deliveryLatencyMs?: number | null
  landedInSpam?: boolean | null
}

export interface ReportCheckRun {
  checkType: string
  status: 'ok' | 'failed'
  startedAt: Date
}

export interface ReportInput {
  organizationName: string
  site: { label: string; url: string; hostname: string }
  period: ReportPeriod
  uptimeSamples: readonly UptimeSample[]
  findings: readonly ReportFinding[]
  formRuns: readonly ReportFormRun[]
  checkRuns: readonly ReportCheckRun[]
  slaTarget?: number
  expectedIntervalMs?: number
  /** Marca a apresentar no relatório. Por omissão, Jellycare. */
  brand?: { name: string; url: string }
}

export interface FindingsSummary {
  opened: number
  resolved: number
  stillOpen: number
  openBySeverity: Record<Severity, number>
  /** Os problemas em aberto mais graves, para o corpo do relatório. */
  highlights: ReportFinding[]
  /** Problemas resolvidos durante o período, para mostrar o trabalho feito. */
  resolvedHighlights: ReportFinding[]
}

export interface FormsSummary {
  submissions: number
  submissionFailures: number
  delivered: number
  notDelivered: number
  landedInSpam: number
  averageLatencyMs: number | null
}

export interface ActivitySummary {
  checksRun: number
  checksFailed: number
  byType: { checkType: string; runs: number; failures: number }[]
}

export interface ReportData {
  organizationName: string
  site: ReportInput['site']
  period: ReportPeriod
  brand: { name: string; url: string }
  uptime: UptimeSummary
  findings: FindingsSummary
  forms: FormsSummary
  activity: ActivitySummary
  /** Resumo executivo, em linguagem de negócio. */
  summary: string[]
  recommendations: string[]
  generatedAt: Date
}

const EMPTY_BY_SEVERITY: Record<Severity, number> = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
}

function within(date: Date | null | undefined, period: ReportPeriod): boolean {
  if (!date) return false
  return date.getTime() >= period.start.getTime() && date.getTime() < period.end.getTime()
}

/** O problema estava em aberto no fim do período? */
function openAtPeriodEnd(finding: ReportFinding, period: ReportPeriod): boolean {
  if (finding.firstSeenAt.getTime() >= period.end.getTime()) return false
  if (!finding.resolvedAt) return finding.state !== 'resolved' && finding.state !== 'ignored'
  return finding.resolvedAt.getTime() >= period.end.getTime()
}

function summariseFindings(
  findings: readonly ReportFinding[],
  period: ReportPeriod,
): FindingsSummary {
  const openBySeverity = { ...EMPTY_BY_SEVERITY }
  const stillOpenList: ReportFinding[] = []
  const resolvedList: ReportFinding[] = []

  let opened = 0
  for (const finding of findings) {
    if (within(finding.firstSeenAt, period)) opened++
    if (within(finding.resolvedAt, period)) resolvedList.push(finding)

    if (openAtPeriodEnd(finding, period)) {
      stillOpenList.push(finding)
      openBySeverity[finding.severity]++
    }
  }

  const bySeverityThenAge = (a: ReportFinding, b: ReportFinding) => {
    const severity = severityRank(b.severity) - severityRank(a.severity)
    return severity !== 0 ? severity : a.firstSeenAt.getTime() - b.firstSeenAt.getTime()
  }

  return {
    opened,
    resolved: resolvedList.length,
    stillOpen: stillOpenList.length,
    openBySeverity,
    highlights: [...stillOpenList].sort(bySeverityThenAge).slice(0, 8),
    resolvedHighlights: [...resolvedList].sort(bySeverityThenAge).slice(0, 8),
  }
}

function summariseForms(runs: readonly ReportFormRun[], period: ReportPeriod): FormsSummary {
  const inPeriod = runs.filter((run) => within(run.startedAt, period))

  const latencies = inPeriod
    .map((run) => run.deliveryLatencyMs)
    .filter((value): value is number => typeof value === 'number' && value >= 0)

  return {
    submissions: inPeriod.length,
    submissionFailures: inPeriod.filter((run) => !run.submitted).length,
    delivered: inPeriod.filter((run) => run.emailReceived).length,
    // Só conta como não entregue o que chegou a ser submetido: uma submissão
    // que falhou é outro problema, e contá-la duas vezes distorceria o relatório.
    notDelivered: inPeriod.filter((run) => run.submitted && !run.emailReceived).length,
    landedInSpam: inPeriod.filter((run) => run.landedInSpam === true).length,
    averageLatencyMs:
      latencies.length > 0
        ? latencies.reduce((total, value) => total + value, 0) / latencies.length
        : null,
  }
}

function summariseActivity(
  runs: readonly ReportCheckRun[],
  period: ReportPeriod,
): ActivitySummary {
  const inPeriod = runs.filter((run) => within(run.startedAt, period))
  const byType = new Map<string, { runs: number; failures: number }>()

  for (const run of inPeriod) {
    const entry = byType.get(run.checkType) ?? { runs: 0, failures: 0 }
    entry.runs++
    if (run.status === 'failed') entry.failures++
    byType.set(run.checkType, entry)
  }

  return {
    checksRun: inPeriod.length,
    checksFailed: inPeriod.filter((run) => run.status === 'failed').length,
    byType: [...byType.entries()]
      .map(([checkType, entry]) => ({ checkType, ...entry }))
      .sort((a, b) => b.runs - a.runs),
  }
}

function formatPercent(value: number): string {
  return `${value.toFixed(2).replace('.', ',')}%`
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const hoursLabel = `${hours} ${hours === 1 ? 'hora' : 'horas'}`
  return rest === 0 ? hoursLabel : `${hoursLabel} e ${rest} min`
}

/**
 * Resumo executivo.
 *
 * Escrito para quem paga a fatura, não para quem administra o servidor: o que
 * aconteceu, o que isso significou para o negócio e o que falta fazer. Quando
 * não há dados suficientes, diz-se isso em vez de apresentar uma percentagem
 * que parece firme.
 */
function buildSummary(
  uptime: UptimeSummary,
  findings: FindingsSummary,
  forms: FormsSummary,
): string[] {
  const lines: string[] = []

  if (uptime.uptimePercent === null) {
    lines.push('Não houve observações de disponibilidade neste período.')
  } else if (uptime.slaMet === null) {
    lines.push(
      `O site esteve disponível em ${formatPercent(uptime.uptimePercent)} das verificações, ` +
        'mas a monitorização não cobriu o período todo — o valor é indicativo.',
    )
  } else if (uptime.incidents.length === 0) {
    lines.push(
      `O site esteve sempre disponível, com ${formatPercent(uptime.uptimePercent)} de ` +
        `disponibilidade e nenhuma interrupção registada.`,
    )
  } else {
    const plural = uptime.incidents.length === 1 ? 'interrupção' : 'interrupções'
    lines.push(
      `O site esteve disponível ${formatPercent(uptime.uptimePercent)} do tempo, com ` +
        `${uptime.incidents.length} ${plural} num total de ` +
        `${formatDuration(uptime.totalDowntimeMs)}.`,
    )
    lines.push(
      uptime.slaMet
        ? `O objetivo de ${formatPercent(uptime.slaTarget)} foi cumprido.`
        : `O objetivo de ${formatPercent(uptime.slaTarget)} não foi cumprido neste mês.`,
    )
  }

  if (findings.resolved > 0) {
    lines.push(
      findings.resolved === 1
        ? 'Foi corrigido 1 problema durante o mês.'
        : `Foram corrigidos ${findings.resolved} problemas durante o mês.`,
    )
  }

  const criticos = findings.openBySeverity.critical + findings.openBySeverity.high
  if (criticos > 0) {
    lines.push(
      criticos === 1
        ? 'Fica 1 problema de gravidade elevada por resolver, detalhado adiante.'
        : `Ficam ${criticos} problemas de gravidade elevada por resolver, detalhados adiante.`,
    )
  } else if (findings.stillOpen > 0) {
    lines.push(
      findings.stillOpen === 1
        ? 'Fica 1 ponto de melhoria em aberto, sem urgência.'
        : `Ficam ${findings.stillOpen} pontos de melhoria em aberto, nenhum deles urgente.`,
    )
  } else if (findings.opened > 0 || findings.resolved > 0) {
    lines.push('Não ficou nenhum problema por resolver.')
  }

  if (forms.submissions > 0) {
    const falhados = forms.submissionFailures + forms.notDelivered
    if (falhados > 0) {
      lines.push(
        `Dos ${forms.submissions} ${forms.submissions === 1 ? 'teste' : 'testes'} aos formulários ` +
          `de contacto, ${falhados} ${
            falhados === 1 ? 'não resultou' : 'não resultaram'
          } na receção da mensagem — ou seja, pedidos de clientes que se teriam perdido.`,
      )
    } else {
      lines.push(
        `Os formulários de contacto foram testados ${forms.submissions} ` +
          `${forms.submissions === 1 ? 'vez' : 'vezes'} e as notificações chegaram sempre.`,
      )
    }
  }

  return lines
}

/** Ações concretas, pela ordem em que valem a pena. */
function buildRecommendations(findings: FindingsSummary, forms: FormsSummary): string[] {
  const recommendations: string[] = []

  for (const finding of findings.highlights) {
    if (severityRank(finding.severity) < severityRank('medium')) continue
    recommendations.push(finding.title)
    if (recommendations.length >= 5) break
  }

  if (forms.landedInSpam > 0 && recommendations.length < 5) {
    recommendations.push(
      'Alinhar SPF, DKIM e DMARC do domínio para que as notificações dos formulários deixem de ' +
        'ser classificadas como spam.',
    )
  }

  if (recommendations.length === 0) {
    recommendations.push(
      'Não há ações pendentes. A monitorização continua e qualquer alteração é comunicada.',
    )
  }

  return recommendations
}

export function buildReport(input: ReportInput): ReportData {
  const uptime = summariseUptime(input.uptimeSamples, {
    period: input.period,
    ...(input.slaTarget !== undefined ? { slaTarget: input.slaTarget } : {}),
    ...(input.expectedIntervalMs !== undefined
      ? { expectedIntervalMs: input.expectedIntervalMs }
      : {}),
  })

  const findings = summariseFindings(input.findings, input.period)
  const forms = summariseForms(input.formRuns, input.period)
  const activity = summariseActivity(input.checkRuns, input.period)

  return {
    organizationName: input.organizationName,
    site: input.site,
    period: input.period,
    brand: input.brand ?? { name: 'Jellycare', url: 'https://jellycare.pt' },
    uptime,
    findings,
    forms,
    activity,
    summary: buildSummary(uptime, findings, forms),
    recommendations: buildRecommendations(findings, forms),
    generatedAt: new Date(),
  }
}

export { formatDuration, formatPercent }
