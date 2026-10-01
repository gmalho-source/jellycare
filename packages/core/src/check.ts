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

/**
 * Uma imagem da página tirada durante a verificação.
 *
 * Hoje só a PageSpeed a devolve: o Lighthouse fotografa a página no fim da
 * medição, e é essa a imagem que o painel mostra na grelha de sites. Não é
 * uma observação sobre o site, por isso não entra nas métricas nem nos
 * problemas.
 */
export interface CheckCapture {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  data: Buffer
}

export interface CheckOutcome {
  status: CheckStatus
  findings: ObservedFinding[]
  /** Séries numéricas para histórico e relatório, ex. `responseTimeMs`. */
  metrics: Record<string, number>
  /** Preenchido quando `status` é `failed`. */
  error?: string
  /**
   * Correu, mas não em força.
   *
   * Um check pode ter sucesso com menos cobertura do que devia: uma fonte de
   * reputação que não respondeu, um orçamento de rastreio esgotado antes do
   * fim do site. Isso não é um problema do cliente — não lhe diz respeito e
   * não lhe pertence — mas também não pode desaparecer, senão a plataforma
   * degrada-se em silêncio e continua a dizer que está tudo bem.
   *
   * Fica registado na execução, para quem opera a plataforma.
   */
  warnings?: string[]
  /** Ver `CheckCapture`. Só numa execução com sucesso. */
  capture?: CheckCapture
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
  /** Ver `CheckOutcome.warnings`. */
  warnings?: string[]
  capture?: CheckCapture
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
      ...(result.warnings && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      ...(result.capture ? { capture: result.capture } : {}),
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
