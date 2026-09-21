import type { CheckOutcome, ObservedFinding } from '@jellycare/core'

/**
 * Corroboração entre regiões.
 *
 * Uma probe sozinha não sabe distinguir "o site caiu" de "o caminho de rede
 * entre esta probe e o site partiu-se". A confirmação temporal que o check de
 * uptime já faz protege contra falhas momentâneas, mas não contra uma rota
 * partida que dura uma hora — nesse caso alertaríamos o cliente por causa de um
 * problema que nenhum dos visitantes dele tem.
 */

export interface RegionSample {
  region: string
  up: boolean
  observedAt: Date
}

export interface CorroborationOptions {
  /** Região desta instância de worker. */
  region: string
  /** Idade máxima de uma amostra de outra região para ser considerada. */
  windowMs?: number
  now: Date
}

export type CorroborationVerdict =
  /** Outra região confirma que o site está em baixo. */
  | 'corroborated'
  /** Outra região alcança o site: o problema é do caminho, não do site. */
  | 'contradicted'
  /** Não há amostras recentes de outra região. */
  | 'no_data'
  /** O run não observou indisponibilidade. */
  | 'not_applicable'

const DEFAULT_WINDOW_MS = 10 * 60_000

export interface CorroborationResult {
  findings: ObservedFinding[]
  verdict: CorroborationVerdict
  /** Regiões que alcançaram o site dentro da janela. */
  reachableFrom: string[]
}

/**
 * Ajusta os findings de indisponibilidade à luz do que as outras regiões viram.
 *
 * Quando outra região alcança o site, o `site_down` crítico é substituído por
 * um finding próprio, de severidade média: não se cala o problema — uma região
 * bloqueada por geo-restrição ou um CDN com uma borda em baixo é informação
 * real — mas também não se acorda ninguém a dizer que o site caiu quando ele
 * está de pé para quase toda a gente.
 */
export function applyRegionCorroboration(
  findings: readonly ObservedFinding[],
  otherRegionSamples: readonly RegionSample[],
  options: CorroborationOptions,
): CorroborationResult {
  const down = findings.find((finding) => finding.code === 'site_down')
  if (!down) {
    return { findings: [...findings], verdict: 'not_applicable', reachableFrom: [] }
  }

  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const cutoff = options.now.getTime() - windowMs

  const recent = otherRegionSamples.filter(
    (sample) => sample.region !== options.region && sample.observedAt.getTime() >= cutoff,
  )

  if (recent.length === 0) {
    // Sem segunda opinião, vale o que esta região observou. É o comportamento
    // de quem corre uma região só, e é melhor do que não alertar de todo.
    return { findings: [...findings], verdict: 'no_data', reachableFrom: [] }
  }

  const reachableFrom = [...new Set(recent.filter((sample) => sample.up).map((s) => s.region))]

  if (reachableFrom.length === 0) {
    return { findings: [...findings], verdict: 'corroborated', reachableFrom: [] }
  }

  const replacement: ObservedFinding = {
    code: 'site_unreachable_from_region',
    discriminator: options.region,
    severity: 'medium',
    title: `Site inacessível a partir de ${options.region}`,
    detail:
      `A probe de ${options.region} não alcança o site, mas ${formatRegions(reachableFrom)} ` +
      'alcança. O site está de pé; o problema é de encaminhamento, geo-restrição ou de uma ' +
      'borda do CDN.',
    evidence: {
      failingRegion: options.region,
      reachableFrom,
      originalReason: down.evidence,
    },
  }

  return {
    findings: [replacement, ...findings.filter((finding) => finding.code !== 'site_down')],
    verdict: 'contradicted',
    reachableFrom,
  }
}

function formatRegions(regions: readonly string[]): string {
  if (regions.length === 1) return `a de ${regions[0]}`
  return `as de ${regions.slice(0, -1).join(', ')} e ${regions[regions.length - 1]}`
}

export interface UptimeSampleInput {
  region: string
  observedAt: Date
  up: boolean
  statusCode: number | null
  responseTimeMs: number | null
  failureReason: string | null
}

/**
 * Traduz o resultado do check de uptime numa amostra.
 *
 * A amostra é gravada mesmo quando o check falha por exceção: sem isso, um
 * período de instabilidade do próprio worker apareceria ao cliente como
 * disponibilidade perfeita, porque simplesmente não teria amostras.
 */
export function toUptimeSample(
  outcome: CheckOutcome,
  options: { region: string; observedAt: Date },
): UptimeSampleInput {
  const downFinding = outcome.findings.find(
    (finding) => finding.code === 'site_down' || finding.code === 'content_missing',
  )

  const statusCode = outcome.metrics.statusCode
  const responseTimeMs = outcome.metrics.responseTimeMs

  return {
    region: options.region,
    observedAt: options.observedAt,
    // Um check que rebentou não observou nada; contar isso como "em cima"
    // inflacionaria o SLA que reportamos ao cliente.
    up: outcome.status === 'ok' && outcome.metrics.up === 1,
    statusCode: typeof statusCode === 'number' ? statusCode : null,
    responseTimeMs: typeof responseTimeMs === 'number' ? responseTimeMs : null,
    failureReason:
      outcome.status === 'failed'
        ? (outcome.error ?? 'erro na execução do check')
        : downFinding
          ? ((downFinding.evidence?.['reason'] as string | undefined) ?? downFinding.code)
          : null,
  }
}
