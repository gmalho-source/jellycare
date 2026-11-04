import type { ReportPeriod } from './period.js'
import { periodDurationMs } from './period.js'

/**
 * Disponibilidade e SLA a partir das amostras.
 *
 * O número que vai no relatório é o que o cliente usa para avaliar o contrato,
 * por isso importa mais ser honesto do que ser bonito: as interrupções são
 * medidas entre a primeira falha e a recuperação seguinte, as falhas da nossa
 * própria monitorização não são contadas como indisponibilidade do site, e o
 * relatório diz sempre que percentagem do período foi efetivamente observada.
 */

export interface UptimeSample {
  observedAt: Date
  up: boolean
  /** Região da probe. Ausente nas amostras de quem corre uma região só. */
  region?: string | null
  failureReason?: string | null
  responseTimeMs?: number | null
}

export interface Incident {
  start: Date
  end: Date
  durationMs: number
  /** Causa mais frequente durante a interrupção. */
  reason: string | null
  /** A interrupção ainda estava a decorrer no fim do período. */
  ongoing: boolean
}

export interface UptimeSummary {
  samples: number
  upSamples: number
  /** `null` quando não há amostras nenhumas no período. */
  uptimePercent: number | null
  incidents: Incident[]
  totalDowntimeMs: number
  longestIncidentMs: number
  averageResponseTimeMs: number | null
  slaTarget: number
  /** `null` quando não há dados suficientes para afirmar seja o que for. */
  slaMet: boolean | null
  /**
   * Fração do período com observações, de 0 a 1. Abaixo de 1 significa que a
   * monitorização teve lacunas, e o relatório deve dizê-lo em vez de apresentar
   * uma percentagem que parece mais firme do que é.
   */
  coverage: number | null
}

export interface UptimeOptions {
  period: ReportPeriod
  /** Percentagem contratada. */
  slaTarget?: number
  /** Periodicidade esperada das amostras. */
  expectedIntervalMs?: number
  /**
   * Intervalo acima do qual se considera que houve uma lacuna na monitorização
   * em vez de continuidade. Impede que um worker em baixo durante a noite
   * apareça ao cliente como dez horas de site em baixo.
   */
  maxGapMs?: number
}

const DEFAULT_INTERVAL_MS = 5 * 60_000

function commonReason(samples: readonly UptimeSample[]): string | null {
  const counts = new Map<string, number>()
  for (const sample of samples) {
    const reason = sample.failureReason?.trim()
    if (!reason) continue
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }

  let best: string | null = null
  let bestCount = 0
  for (const [reason, count] of counts) {
    if (count > bestCount) {
      best = reason
      bestCount = count
    }
  }
  return best
}

/**
 * Quanto tempo a última observação de uma região continua a valer quando se
 * juntam as regiões. O mesmo valor da corroboração no worker: duas regiões com
 * o uptime de cinco em cinco minutos cruzam-se sempre dentro desta janela.
 */
export const REGION_MERGE_WINDOW_MS = 10 * 60_000

/**
 * Junta as amostras de várias regiões numa só linha do tempo.
 *
 * Com duas probes, as amostras intercalam-se. Contadas uma a uma, uma região
 * barrada pela firewall do servidor e outra que vê o site davam uma interrupção
 * de dois minutos e meio a cada cinco — o site de pé para toda a gente e o
 * relatório a dizer o contrário.
 *
 * A regra é a mesma da corroboração: o site está em cima se alguma região o
 * viu em cima na sua observação mais recente (dentro da janela). Só está em
 * baixo quando todas as regiões com observação recente o veem em baixo. Uma
 * queda verdadeira começa assim a contar quando a segunda região a confirma,
 * no máximo um intervalo depois — o preço de não acusar o caminho de rede.
 *
 * Cada amostra de entrada dá uma amostra de saída, ordenadas por data. Com uma
 * região só, devolve as mesmas amostras por ordem.
 */
export function mergeRegionSamples(
  samples: readonly UptimeSample[],
  windowMs = REGION_MERGE_WINDOW_MS,
): UptimeSample[] {
  const sorted = [...samples].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())
  const regions = new Set(sorted.map((sample) => sample.region ?? ''))
  if (regions.size <= 1) return sorted

  const latest = new Map<string, UptimeSample>()
  return sorted.map((sample) => {
    latest.set(sample.region ?? '', sample)
    const at = sample.observedAt.getTime()
    const up = [...latest.values()].some(
      (other) => other.up && at - other.observedAt.getTime() <= windowMs,
    )
    const merged: UptimeSample = { observedAt: sample.observedAt, up }
    if (sample.region !== undefined) merged.region = sample.region
    // A causa só interessa quando a amostra juntada está em baixo; o tempo de
    // resposta só existe quando esta probe chegou mesmo ao site.
    if (!up && sample.failureReason !== undefined) merged.failureReason = sample.failureReason
    if (sample.up && sample.responseTimeMs !== undefined) merged.responseTimeMs = sample.responseTimeMs
    return merged
  })
}

export function summariseUptime(
  rawSamples: readonly UptimeSample[],
  options: UptimeOptions,
): UptimeSummary {
  const { period } = options
  const slaTarget = options.slaTarget ?? 99.9
  const interval = options.expectedIntervalMs ?? DEFAULT_INTERVAL_MS
  const maxGapMs = options.maxGapMs ?? interval * 4

  const samples = mergeRegionSamples(
    rawSamples.filter(
      (sample) =>
        sample.observedAt.getTime() >= period.start.getTime() &&
        sample.observedAt.getTime() < period.end.getTime(),
    ),
  )

  if (samples.length === 0) {
    return {
      samples: 0,
      upSamples: 0,
      uptimePercent: null,
      incidents: [],
      totalDowntimeMs: 0,
      longestIncidentMs: 0,
      averageResponseTimeMs: null,
      slaTarget,
      slaMet: null,
      coverage: null,
    }
  }

  const upSamples = samples.filter((sample) => sample.up).length
  const uptimePercent = (upSamples / samples.length) * 100

  const responseTimes = samples
    .map((sample) => sample.responseTimeMs)
    .filter((value): value is number => typeof value === 'number' && value >= 0)
  const averageResponseTimeMs =
    responseTimes.length > 0
      ? responseTimes.reduce((total, value) => total + value, 0) / responseTimes.length
      : null

  const incidents: Incident[] = []
  let current: UptimeSample[] = []

  const close = (endAt: Date, ongoing: boolean) => {
    if (current.length === 0) return
    const start = current[0]!.observedAt
    const end = endAt.getTime() > start.getTime() ? endAt : new Date(start.getTime() + interval)
    incidents.push({
      start,
      end,
      durationMs: end.getTime() - start.getTime(),
      reason: commonReason(current),
      ongoing,
    })
    current = []
  }

  for (const [index, sample] of samples.entries()) {
    const previous = samples[index - 1]

    // Uma lacuna maior do que o tolerado quebra a continuidade: não sabemos o
    // que aconteceu no meio e não o vamos inventar.
    if (
      current.length > 0 &&
      previous &&
      sample.observedAt.getTime() - previous.observedAt.getTime() > maxGapMs
    ) {
      close(new Date(previous.observedAt.getTime() + interval), false)
    }

    if (sample.up) {
      close(sample.observedAt, false)
      continue
    }

    current.push(sample)
  }

  // Ainda em baixo quando o período acabou.
  close(new Date(Math.min(period.end.getTime(), samples.at(-1)!.observedAt.getTime() + interval)), true)

  const totalDowntimeMs = incidents.reduce((total, incident) => total + incident.durationMs, 0)
  const longestIncidentMs = incidents.reduce(
    (longest, incident) => Math.max(longest, incident.durationMs),
    0,
  )

  const expectedSamples = periodDurationMs(period) / interval
  const coverage = expectedSamples > 0 ? Math.min(1, samples.length / expectedSamples) : null

  return {
    samples: samples.length,
    upSamples,
    uptimePercent,
    incidents,
    totalDowntimeMs,
    longestIncidentMs,
    averageResponseTimeMs,
    slaTarget,
    // Com menos de metade do período observado, qualquer afirmação sobre o
    // cumprimento do SLA seria uma suposição apresentada como facto.
    slaMet: coverage !== null && coverage >= 0.5 ? uptimePercent >= slaTarget : null,
    coverage,
  }
}

/**
 * As interrupções mais recentes primeiro, até `limit`.
 *
 * `summariseUptime` devolve-as por ordem cronológica, que é a certa para o
 * relatório mensal — lê-se como um registo do mês. Num cartão que mostra só
 * algumas, cortar as primeiras dava as mais antigas e escondia as de ontem.
 */
export function latestIncidents(incidents: readonly Incident[], limit: number): Incident[] {
  return [...incidents]
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .slice(0, Math.max(0, limit))
}
