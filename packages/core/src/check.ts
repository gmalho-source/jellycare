import type { ObservedFinding } from './finding.js'

/**
 * Identificação da plataforma em qualquer pedido que saia daqui. Um crawler
 * anónimo acaba em blacklists e não dá ao alojamento do cliente forma de nos
 * contactar quando algo corre mal.
 */
export const USER_AGENT = 'JellycareBot/1.0 (+https://jellycare.pt/bot)'

export interface Site {
  id: string
  organizationId: string
  /** URL base canónico, sem barra final. */
  url: string
  hostname: string
  label: string
}

export interface CheckContext {
  site: Site
  now: Date
  /** Injetável para testes e para trocar de cliente HTTP sem tocar nos checks. */
  fetch: typeof globalThis.fetch
  signal?: AbortSignal
}

export type CheckStatus = 'ok' | 'failed'

export interface CheckOutcome {
  status: CheckStatus
  findings: ObservedFinding[]
  /** Séries numéricas para histórico e relatório, ex. `responseTimeMs`. */
  metrics: Record<string, number>
  /** Preenchido quando `status` é `failed`. */
  error?: string
  durationMs: number
}

export interface CheckDefinition<TConfig = Record<string, never>> {
  type: string
  /** Periodicidade por defeito; sobreponível por site e por plano. */
  defaultIntervalMinutes: number
  /**
   * Observações consecutivas antes de notificar. Maior que 1 nos checks cujo
   * falso positivo é frequente: uptime e links externos.
   */
  confirmationsRequired: number
  run(context: CheckContext, config: TConfig): Promise<CheckResult>
}

/** O que a implementação de um check devolve; o tempo é medido pelo runner. */
export interface CheckResult {
  findings: ObservedFinding[]
  metrics?: Record<string, number>
}

/**
 * Executa um check isolando falhas. Um check que rebenta marca o run como
 * `failed` — nunca como um run bem-sucedido sem problemas, porque isso levaria
 * a reconciliação a resolver tudo o que estava aberto.
 */
export async function runCheck<TConfig>(
  definition: CheckDefinition<TConfig>,
  context: CheckContext,
  config: TConfig,
): Promise<CheckOutcome> {
  const startedAt = Date.now()
  try {
    const result = await definition.run(context, config)
    return {
      status: 'ok',
      findings: result.findings,
      metrics: result.metrics ?? {},
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      status: 'failed',
      findings: [],
      metrics: {},
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }
  }
}
