import { explicacaoDe, severityRank, type Severity } from '@jellycare/core'
import type { ReportPeriod } from './period.js'
import { includedSections, type ReportSectionKey } from './sections.js'
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

/** Uma medição de velocidade, telemóvel ou computador. */
export interface ReportPageSpeedRun {
  strategy: 'mobile' | 'desktop'
  startedAt: Date
  performanceScore: number | null
  lcpMs: number | null
  cls: number | null
  tbtMs: number | null
}

export interface ReportWordPress {
  /** O inventário à data do relatório, e não o do fim do período: não há histórico dele. */
  components: { kind: string; name: string; version: string | null; latestVersion: string | null }[]
  updates: {
    name: string
    fromVersion: string | null
    toVersion: string | null
    status: string
    orderedAt: Date
  }[]
  backups: { startedAt: Date; finishedAt: Date | null; status: string }[]
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
  /** Medições de velocidade do período. */
  pageSpeedRuns?: readonly ReportPageSpeedRun[]
  /** Só quando o site está ligado a uma ferramenta de manutenção. */
  wordpress?: ReportWordPress | null
  /** Os módulos que ficam de fora para este cliente. */
  excludedSections?: readonly string[]
  /** As notas da equipa que entram neste relatório. */
  notes?: readonly string[]
  /**
   * Quando o site começou a ser acompanhado. Um site que entrou a meio do
   * período só é medido a partir daí: a cobertura e o SLA contam sobre os dias
   * vigiados, e não sobre dias em que ainda não estava na plataforma.
   */
  monitoredFrom?: Date
}

export interface PageSpeedStrategySummary {
  runs: number
  latestScore: number | null
  firstScore: number | null
  lcpMs: number | null
  cls: number | null
  tbtMs: number | null
}

export interface PerformanceSummary {
  mobile: PageSpeedStrategySummary | null
  desktop: PageSpeedStrategySummary | null
}

export interface WordPressSummary {
  updatesApplied: ReportWordPress['updates']
  updatesFailed: number
  pendingUpdates: number
  coreOutdated: { version: string | null; latestVersion: string } | null
  backups: number
  backupsFailed: number
  lastBackupAt: Date | null
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
  /** O início do acompanhamento, quando cai dentro do período. Nulo de resto. */
  monitoredFrom: Date | null
  brand: { name: string; url: string }
  uptime: UptimeSummary
  findings: FindingsSummary
  forms: FormsSummary
  activity: ActivitySummary
  performance: PerformanceSummary
  wordpress: WordPressSummary | null
  /** Os módulos que entram, pela ordem em que aparecem. */
  sections: ReportSectionKey[]
  /** Notas da equipa, tal como foram escritas. */
  notes: string[]
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
  sections: ReadonlySet<ReportSectionKey>,
): string[] {
  const lines: string[] = []

  // Cada frase do resumo pertence a um módulo e sai com ele. Um resumo que fala
  // de uma secção que o cliente não vai encontrar mais abaixo lê-se como erro.
  if (!sections.has('disponibilidade')) {
    // nada a dizer sobre disponibilidade
  } else if (uptime.uptimePercent === null) {
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

  if (sections.has('seguranca') && findings.resolved > 0) {
    lines.push(
      findings.resolved === 1
        ? 'Foi corrigido 1 problema durante o mês.'
        : `Foram corrigidos ${findings.resolved} problemas durante o mês.`,
    )
  }

  const criticos = findings.openBySeverity.critical + findings.openBySeverity.high
  if (!sections.has('seguranca')) {
    // nada a dizer sobre problemas
  } else if (criticos > 0) {
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

  if (sections.has('formularios') && forms.submissions > 0) {
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

  if (lines.length === 0) {
    lines.push('Resumo do acompanhamento do site durante o mês.')
  }

  return lines
}

/** Ações concretas, pela ordem em que valem a pena. */
function buildRecommendations(
  findings: FindingsSummary,
  forms: FormsSummary,
  sections: ReadonlySet<ReportSectionKey>,
): string[] {
  const recommendations: string[] = []

  // Uma ação sobre um problema que o relatório não mostra obrigava o cliente a
  // perguntar de onde vem. Sai com o módulo de onde nasceu.
  for (const finding of sections.has('seguranca') ? findings.highlights : []) {
    if (severityRank(finding.severity) < severityRank('medium')) continue
    // O que a Jelly vai fazer, e não o nome técnico do problema. Uma lista de
    // ações que diz «Falta o header Strict-Transport-Security» não é uma lista
    // de ações: é a lista de problemas outra vez.
    const explicacao = explicacaoDe(finding.code)
    recommendations.push(explicacao?.oQueFazemos ?? finding.title)
    if (recommendations.length >= 5) break
  }

  if (sections.has('formularios') && forms.landedInSpam > 0 && recommendations.length < 5) {
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

function summariseStrategy(
  runs: readonly ReportPageSpeedRun[],
): PageSpeedStrategySummary | null {
  const comPontuacao = [...runs]
    .filter((run) => run.performanceScore !== null)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  if (comPontuacao.length === 0) return null
  const ultima = comPontuacao[comPontuacao.length - 1]!
  return {
    runs: comPontuacao.length,
    latestScore: ultima.performanceScore,
    firstScore: comPontuacao[0]!.performanceScore,
    lcpMs: ultima.lcpMs,
    cls: ultima.cls,
    tbtMs: ultima.tbtMs,
  }
}

function summarisePerformance(
  runs: readonly ReportPageSpeedRun[],
  period: ReportPeriod,
): PerformanceSummary {
  const doPeriodo = runs.filter((run) => within(run.startedAt, period))
  return {
    mobile: summariseStrategy(doPeriodo.filter((run) => run.strategy === 'mobile')),
    desktop: summariseStrategy(doPeriodo.filter((run) => run.strategy === 'desktop')),
  }
}

function summariseWordPress(
  wordpress: ReportWordPress | null | undefined,
  period: ReportPeriod,
): WordPressSummary | null {
  if (!wordpress) return null
  const atualizacoes = wordpress.updates.filter((update) => within(update.orderedAt, period))
  const copias = wordpress.backups.filter((backup) => within(backup.startedAt, period))
  const concluidas = copias
    .filter((backup) => backup.status === 'FINISHED' && backup.finishedAt)
    .map((backup) => backup.finishedAt!)
    .sort((a, b) => b.getTime() - a.getTime())
  const core = wordpress.components.find((component) => component.kind === 'core')

  return {
    updatesApplied: atualizacoes.filter((update) => update.status === 'succeeded'),
    updatesFailed: atualizacoes.filter((update) => update.status === 'failed').length,
    pendingUpdates: wordpress.components.filter(
      (component) => component.kind !== 'core' && component.latestVersion !== null,
    ).length,
    coreOutdated:
      core && core.latestVersion
        ? { version: core.version, latestVersion: core.latestVersion }
        : null,
    backups: concluidas.length,
    backupsFailed: copias.filter((backup) => backup.status === 'ERROR').length,
    lastBackupAt: concluidas[0] ?? null,
  }
}

export function buildReport(input: ReportInput): ReportData {
  const inicio = input.monitoredFrom
  const monitoredFrom =
    inicio &&
    inicio.getTime() > input.period.start.getTime() &&
    inicio.getTime() < input.period.end.getTime()
      ? inicio
      : null

  // A disponibilidade conta sobre a janela vigiada. Contada sobre o mês
  // inteiro, um site que entrou a dia 22 aparecia com 27% de cobertura e sem
  // juízo sobre o SLA — nove dias medidos a parecerem trinta mal medidos.
  const uptime = summariseUptime(input.uptimeSamples, {
    period: monitoredFrom ? { ...input.period, start: monitoredFrom } : input.period,
    ...(input.slaTarget !== undefined ? { slaTarget: input.slaTarget } : {}),
    ...(input.expectedIntervalMs !== undefined
      ? { expectedIntervalMs: input.expectedIntervalMs }
      : {}),
  })

  const findings = summariseFindings(input.findings, input.period)
  const forms = summariseForms(input.formRuns, input.period)
  const activity = summariseActivity(input.checkRuns, input.period)
  const performance = summarisePerformance(input.pageSpeedRuns ?? [], input.period)
  const wordpress = summariseWordPress(input.wordpress, input.period)

  // Um módulo sem nada que o sustente não entra, esteja ou não ligado: o do
  // WordPress num site que não é WordPress seria uma secção vazia a dizer que
  // não há nada, e isso lê-se como falha.
  const pedidos = includedSections(input.excludedSections ?? [])
  if (!wordpress) pedidos.delete('wordpress')

  return {
    organizationName: input.organizationName,
    site: input.site,
    period: input.period,
    monitoredFrom,
    brand: input.brand ?? { name: 'Jellycare', url: 'https://jellycare.pt' },
    uptime,
    findings,
    forms,
    activity,
    performance,
    wordpress,
    sections: [...pedidos],
    notes: (input.notes ?? []).map((nota) => nota.trim()).filter((nota) => nota.length > 0),
    summary: buildSummary(uptime, findings, forms, pedidos),
    recommendations: buildRecommendations(findings, forms, pedidos),
    generatedAt: new Date(),
  }
}

export { formatDuration, formatPercent }
