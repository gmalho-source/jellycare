import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import { USER_AGENT } from '@jellycare/core'

export type PageSpeedStrategy = 'mobile' | 'desktop'

export interface PageSpeedConfig {
  /** Chave da plataforma para a PageSpeed Insights. Ver `MISSING_KEY_HINT`. */
  apiKey?: string
  /** Telemóvel por defeito: é o que a Google usa para indexar. */
  strategy?: PageSpeedStrategy
  timeoutMs?: number
  /** URL a medir, quando não é a homepage. */
  url?: string
}

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

/**
 * O nome exato da variável, para o caso de ela faltar.
 *
 * Um segredo definido com o nome errado falha de forma silenciosa em quase
 * todo o lado: o check não corre, ninguém sabe porquê, e descobre-se meses
 * depois. Dizer o nome em voz alta faz a diferença aparecer na primeira
 * execução em vez de ficar guardada.
 */
export const MISSING_KEY_HINT =
  'Falta a chave da PageSpeed Insights: defina GOOGLE_PAGESPEED_API_KEY no worker.'

export class PageSpeedNotConfiguredError extends Error {
  constructor() {
    super(MISSING_KEY_HINT)
    this.name = 'PageSpeedNotConfiguredError'
  }
}

/* -------------------------------------------------------------------------- */
/* Limiares                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Os limiares são os da própria Google para os Core Web Vitals, e não os
 * nossos. Inventar limiares mais apertados dava findings que ninguém
 * conseguia fechar, e mais largos dizia «está bom» sobre páginas que o
 * relatório do Search Console marca a vermelho no mesmo dia.
 */
export const LIMIARES = {
  /** Pontuação de desempenho (0–100). Abaixo de 50 a Google chama-lhe má. */
  scoreMau: 50,
  scoreRazoavel: 90,
  /** Largest Contentful Paint, em milissegundos. */
  lcpMau: 4000,
  lcpRazoavel: 2500,
  /** Cumulative Layout Shift, sem unidade. */
  clsMau: 0.25,
  clsRazoavel: 0.1,
  /** Total Blocking Time, em milissegundos. */
  tbtMau: 600,
  tbtRazoavel: 200,
} as const

interface Audit {
  numericValue?: number
  displayValue?: string
}

interface LighthouseResult {
  categories?: { performance?: { score?: number | null } }
  audits?: Record<string, Audit | undefined>
}

interface PageSpeedResponse {
  lighthouseResult?: LighthouseResult
  error?: { message?: string }
}

/** O que uma medição diz, já em números utilizáveis. */
export interface PageSpeedMeasurement {
  /** 0–100. Nulo quando o Lighthouse não conseguiu pontuar a página. */
  score: number | null
  lcpMs: number | null
  cls: number | null
  tbtMs: number | null
  fcpMs: number | null
  speedIndexMs: number | null
}

function numeric(audits: LighthouseResult['audits'], id: string): number | null {
  const value = audits?.[id]?.numericValue
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Mede uma página pela PageSpeed Insights.
 *
 * A medição é feita pela Google, a partir da infraestrutura dela: nós pedimos
 * o resultado, não carregamos o site do cliente dez vezes para o cronometrar.
 */
export async function measurePageSpeed(
  url: string,
  apiKey: string,
  strategy: PageSpeedStrategy,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<PageSpeedMeasurement> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const query = new URLSearchParams({
    url,
    key: apiKey,
    strategy,
    category: 'performance',
  })

  try {
    const response = await fetchImpl(`${ENDPOINT}?${query.toString()}`, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    })

    if (!response.ok) {
      // A Google explica no corpo o que está mal — uma chave sem a API
      // ativada volta como 403 com o texto a dizê-lo. Sem isto ficava um
      // número e uma ida ao painel da Google a adivinhar. A chave viaja na
      // query, não no corpo, por isso nada de secreto sai daqui.
      const detalhe = await response
        .text()
        .then((texto) => texto.slice(0, 300).replace(/\s+/g, ' ').trim())
        .catch(() => '')
      throw new Error(
        `PageSpeed Insights respondeu ${response.status}${detalhe ? `: ${detalhe}` : ''}`,
      )
    }

    const body = (await response.json()) as PageSpeedResponse
    if (body.error?.message) throw new Error(`PageSpeed Insights: ${body.error.message}`)

    const lighthouse = body.lighthouseResult
    const bruto = lighthouse?.categories?.performance?.score
    const audits = lighthouse?.audits

    return {
      // A pontuação vem entre 0 e 1; guardamo-la em 0–100 porque é assim que
      // aparece em todo o lado, incluindo no que o cliente vê se for ele a
      // correr a mesma ferramenta.
      score: typeof bruto === 'number' && Number.isFinite(bruto) ? Math.round(bruto * 100) : null,
      lcpMs: numeric(audits, 'largest-contentful-paint'),
      cls: numeric(audits, 'cumulative-layout-shift'),
      tbtMs: numeric(audits, 'total-blocking-time'),
      fcpMs: numeric(audits, 'first-contentful-paint'),
      speedIndexMs: numeric(audits, 'speed-index'),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** As métricas que estão fora do limiar, em texto pronto a ler. */
export function vitalsFalhados(medicao: PageSpeedMeasurement): string[] {
  const falhas: string[] = []

  if (medicao.lcpMs !== null && medicao.lcpMs > LIMIARES.lcpRazoavel) {
    falhas.push(
      `o maior elemento da página aparece ao fim de ${(medicao.lcpMs / 1000).toFixed(1)} s ` +
        `(LCP, devia ser abaixo de ${LIMIARES.lcpRazoavel / 1000} s)`,
    )
  }

  if (medicao.cls !== null && medicao.cls > LIMIARES.clsRazoavel) {
    falhas.push(
      `o conteúdo salta enquanto carrega (CLS ${medicao.cls.toFixed(2)}, ` +
        `devia ser abaixo de ${LIMIARES.clsRazoavel})`,
    )
  }

  if (medicao.tbtMs !== null && medicao.tbtMs > LIMIARES.tbtRazoavel) {
    falhas.push(
      `a página fica ${Math.round(medicao.tbtMs)} ms sem responder a cliques ` +
        `(TBT, devia ser abaixo de ${LIMIARES.tbtRazoavel} ms)`,
    )
  }

  return falhas
}

export const pageSpeedCheck: CheckDefinition<PageSpeedConfig> = {
  type: 'page_speed',
  // Uma vez por dia. A medição é cara do lado da Google e a velocidade de um
  // site não muda de hora a hora — muda quando alguém publica alguma coisa.
  defaultIntervalMinutes: 60 * 24,
  // Uma medição do Lighthouse varia entre execuções. Duas seguidas abaixo do
  // limiar é o que separa uma página lenta de um dia mau da Google.
  confirmationsRequired: 2,

  async run(context: CheckContext, config: PageSpeedConfig): Promise<CheckResult> {
    if (!config.apiKey) throw new PageSpeedNotConfiguredError()

    const strategy: PageSpeedStrategy = config.strategy ?? 'mobile'
    const url = config.url ?? context.site.url
    const medicao = await measurePageSpeed(
      url,
      config.apiKey,
      strategy,
      context.fetch,
      config.timeoutMs ?? 90_000,
    )

    const metrics: Record<string, number> = {}
    if (medicao.score !== null) metrics.performanceScore = medicao.score
    if (medicao.lcpMs !== null) metrics.lcpMs = medicao.lcpMs
    if (medicao.cls !== null) metrics.cls = medicao.cls
    if (medicao.tbtMs !== null) metrics.tbtMs = medicao.tbtMs
    if (medicao.fcpMs !== null) metrics.fcpMs = medicao.fcpMs
    if (medicao.speedIndexMs !== null) metrics.speedIndexMs = medicao.speedIndexMs

    // Sem pontuação não há juízo a fazer. Devolver "está tudo bem" faria a
    // reconciliação fechar um problema de desempenho real só porque o
    // Lighthouse não conseguiu carregar a página desta vez.
    if (medicao.score === null) {
      throw new Error('PageSpeed Insights não devolveu pontuação de desempenho')
    }

    const findings: ObservedFinding[] = []
    const falhas = vitalsFalhados(medicao)

    // Um finding só, e não um por métrica: LCP, CLS e TBT maus na mesma
    // página são quase sempre a mesma causa, e três alertas para um problema
    // é a forma mais rápida de ensinar alguém a ignorá-los.
    if (medicao.score < LIMIARES.scoreRazoavel) {
      const mau = medicao.score < LIMIARES.scoreMau
      findings.push({
        code: 'page_speed_poor',
        discriminator: strategy,
        severity: mau ? 'medium' : 'low',
        title: mau
          ? `Página lenta em ${strategy === 'mobile' ? 'telemóvel' : 'computador'} (${medicao.score}/100)`
          : `Desempenho abaixo do bom em ${strategy === 'mobile' ? 'telemóvel' : 'computador'} (${medicao.score}/100)`,
        detail:
          (falhas.length > 0
            ? `O que está a pesar: ${falhas.join('; ')}.`
            : 'A pontuação está abaixo do limiar sem que uma métrica isolada se destaque.') +
          ' A velocidade conta para a posição na pesquisa da Google e é o que faz ' +
          'quem chega pelo telemóvel desistir antes de a página abrir.',
        evidence: {
          url,
          strategy,
          score: medicao.score,
          ...(medicao.lcpMs !== null ? { lcpMs: Math.round(medicao.lcpMs) } : {}),
          ...(medicao.cls !== null ? { cls: Number(medicao.cls.toFixed(3)) } : {}),
          ...(medicao.tbtMs !== null ? { tbtMs: Math.round(medicao.tbtMs) } : {}),
        },
      })
    }

    return { findings, metrics }
  },
}
