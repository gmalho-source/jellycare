import type { CheckCapture, CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import { PONTUACAO_BOA, PONTUACAO_MA, USER_AGENT } from '@jellycare/core'

export type PageSpeedStrategy = 'mobile' | 'desktop'

export interface PageSpeedConfig {
  /** Chave da plataforma para a PageSpeed Insights. Ver `MISSING_KEY_HINT`. */
  apiKey?: string
  timeoutMs?: number
  /** URL a medir, quando não é a homepage. */
  url?: string
}

/**
 * A estratégia pertence ao **tipo de verificação** e não à configuração do
 * site.
 *
 * Se fosse configurável por site, uma configuração errada punha a verificação
 * de computador a medir telemóvel e a escrever o resultado no histórico do
 * computador — dois números diferentes com o mesmo nome, e ninguém saberia
 * qual estava a ler.
 */

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
  scoreMau: PONTUACAO_MA,
  scoreRazoavel: PONTUACAO_BOA,
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
  score?: number | null
  scoreDisplayMode?: string
  /** No `final-screenshot`, a imagem como data URL. */
  details?: { type?: string; data?: string }
}

interface Category {
  score?: number | null
  auditRefs?: { id: string; weight?: number; group?: string }[]
}

interface LighthouseResult {
  categories?: Record<string, Category | undefined>
  audits?: Record<string, Audit | undefined>
}

/**
 * As categorias que se pedem, com os identificadores do Lighthouse.
 *
 * As quatro primeiras são as clássicas, pontuadas de 0 a 100. A última é a
 * «Navegação com agência» — quão bem um agente de IA consegue ler e usar a
 * página —, que entrou no Lighthouse 13.3 e não tem pontuação: tem uma fração
 * de auditorias passadas, como a PageSpeed a mostra («3/3»).
 */
const CATEGORIAS = ['performance', 'accessibility', 'best-practices', 'seo'] as const
export const CATEGORIA_AGENTIC = 'agentic-browsing'

interface PageSpeedResponse {
  lighthouseResult?: LighthouseResult
  error?: { message?: string }
}

/** O que uma medição diz, já em números utilizáveis. */
export interface PageSpeedMeasurement {
  /** 0–100. Nulo quando o Lighthouse não conseguiu pontuar a página. */
  score: number | null
  /** 0–100, como a pontuação de desempenho. Nulo quando não veio. */
  accessibility: number | null
  bestPractices: number | null
  seo: number | null
  /** Auditorias de navegação com agência passadas, sobre as aplicáveis. */
  agentic: { passed: number; total: number } | null
  lcpMs: number | null
  cls: number | null
  tbtMs: number | null
  fcpMs: number | null
  speedIndexMs: number | null
  /** A página como o Lighthouse a viu no fim da medição. Nula quando não veio. */
  captura: CheckCapture | null
}

/** Uma pontuação de categoria em 0–100, que é como aparece em todo o lado. */
function pontuacao(categoria: Category | undefined): number | null {
  const bruto = categoria?.score
  return typeof bruto === 'number' && Number.isFinite(bruto) ? Math.round(bruto * 100) : null
}

/**
 * A fração da navegação com agência, com a mesma conta do relatório do
 * Lighthouse (`ReportUtils.calculateCategoryFraction`).
 *
 * Não contam as auditorias escondidas, manuais ou não aplicáveis, nem as
 * informativas. Passa quem tem pontuação de 0,9 ou mais. Contada de outra
 * maneira, o painel dizia «2/5» sobre a página a que a PageSpeed dá «3/3», e
 * é o cliente quem compara.
 */
export function fracaoAgentic(
  categoria: Category | undefined,
  audits: LighthouseResult['audits'],
): { passed: number; total: number } | null {
  if (!categoria?.auditRefs) return null

  let passed = 0
  let total = 0
  for (const ref of categoria.auditRefs) {
    const audit = audits?.[ref.id]
    if (!audit) continue
    const modo = audit.scoreDisplayMode
    if (ref.group === 'hidden' || modo === 'manual' || modo === 'notApplicable') continue
    if (modo === 'informative') continue
    total++
    if (modo !== 'error' && Number(audit.score) >= 0.9) passed++
  }

  return total > 0 ? { passed, total } : null
}

/** Acima disto não é uma captura do Lighthouse, que anda pelas dezenas de KB. */
const CAPTURA_MAXIMA = 1024 * 1024

/**
 * A captura final do Lighthouse, a partir da data URL que a PageSpeed devolve.
 *
 * Só aceita os três formatos de imagem que um browser mostra sem surpresas, e
 * um tamanho razoável: o que vem de fora e é servido no painel não pode ser
 * qualquer coisa.
 */
export function capturaFinal(audits: LighthouseResult['audits']): CheckCapture | null {
  const dados = audits?.['final-screenshot']?.details?.data
  if (typeof dados !== 'string') return null
  const partes = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dados)
  if (!partes) return null
  const data = Buffer.from(partes[2]!, 'base64')
  if (data.length === 0 || data.length > CAPTURA_MAXIMA) return null
  return { mimeType: partes[1] as CheckCapture['mimeType'], data }
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

  const pedir = (comAgentic: boolean) => {
    const query = new URLSearchParams({ url, key: apiKey, strategy })
    for (const categoria of CATEGORIAS) query.append('category', categoria)
    if (comAgentic) query.append('category', CATEGORIA_AGENTIC)
    return fetchImpl(`${ENDPOINT}?${query.toString()}`, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    })
  }

  try {
    let response = await pedir(true)

    // A navegação com agência é recente e a documentação da API ainda não a
    // lista. Se a API a recusar, mede-se o resto em vez de perder a medição
    // inteira por causa de um indicador experimental. A recusa é validação
    // do pedido e volta logo: não há Lighthouse a correr duas vezes.
    if (response.status === 400) {
      const texto = await response.clone().text().catch(() => '')
      if (texto.includes(CATEGORIA_AGENTIC)) response = await pedir(false)
    }

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
    const categorias = lighthouse?.categories
    const audits = lighthouse?.audits

    return {
      // A pontuação vem entre 0 e 1; guardamo-la em 0–100 porque é assim que
      // aparece em todo o lado, incluindo no que o cliente vê se for ele a
      // correr a mesma ferramenta.
      score: pontuacao(categorias?.performance),
      accessibility: pontuacao(categorias?.accessibility),
      bestPractices: pontuacao(categorias?.['best-practices']),
      seo: pontuacao(categorias?.seo),
      agentic: fracaoAgentic(categorias?.[CATEGORIA_AGENTIC], audits),
      lcpMs: numeric(audits, 'largest-contentful-paint'),
      cls: numeric(audits, 'cumulative-layout-shift'),
      tbtMs: numeric(audits, 'total-blocking-time'),
      fcpMs: numeric(audits, 'first-contentful-paint'),
      speedIndexMs: numeric(audits, 'speed-index'),
      captura: capturaFinal(audits),
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

interface Variante {
  type: string
  strategy: PageSpeedStrategy
  /**
   * Abre problemas a partir da medição.
   *
   * Só o telemóvel o faz. É o que a Google usa para indexar, e é de onde vem
   * quem desiste antes de a página abrir. O computador é medido e mostrado,
   * mas não abre problemas: ligá-lo faria nascer um problema novo em todos os
   * sites com computador lento no dia em que esta verificação entrou, e uma
   * enxurrada de avisos no primeiro dia é a forma mais rápida de ensinar
   * alguém a ignorá-los. Fica a um booleano de distância de mudar de ideias.
   */
  abreProblemas: boolean
}

function criarPageSpeed({ type, strategy, abreProblemas }: Variante): CheckDefinition<PageSpeedConfig> {
  const dispositivo = strategy === 'mobile' ? 'telemóvel' : 'computador'

  return {
    type,
    // Uma vez por dia. A medição é cara do lado da Google e a velocidade de um
    // site não muda de hora a hora — muda quando alguém publica alguma coisa.
    defaultIntervalMinutes: 60 * 24,
    // Uma medição do Lighthouse varia entre execuções. Duas seguidas abaixo do
    // limiar é o que separa uma página lenta de um dia mau da Google.
    confirmationsRequired: 2,

    async run(context: CheckContext, config: PageSpeedConfig): Promise<CheckResult> {
      if (!config.apiKey) throw new PageSpeedNotConfiguredError()

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
      if (medicao.accessibility !== null) metrics.accessibilityScore = medicao.accessibility
      if (medicao.bestPractices !== null) metrics.bestPracticesScore = medicao.bestPractices
      if (medicao.seo !== null) metrics.seoScore = medicao.seo
      if (medicao.agentic) {
        metrics.agenticPassed = medicao.agentic.passed
        metrics.agenticTotal = medicao.agentic.total
      }

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
      if (abreProblemas && medicao.score < LIMIARES.scoreRazoavel) {
        const mau = medicao.score < LIMIARES.scoreMau
        findings.push({
          code: 'page_speed_poor',
          discriminator: strategy,
          severity: mau ? 'medium' : 'low',
          title: mau
            ? `Página lenta em ${dispositivo} (${medicao.score}/100)`
            : `Desempenho abaixo do bom em ${dispositivo} (${medicao.score}/100)`,
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

      return { findings, metrics, ...(medicao.captura ? { capture: medicao.captura } : {}) }
    },
  }
}

export const pageSpeedCheck = criarPageSpeed({
  type: 'page_speed',
  strategy: 'mobile',
  abreProblemas: true,
})

export const pageSpeedDesktopCheck = criarPageSpeed({
  type: 'page_speed_desktop',
  strategy: 'desktop',
  abreProblemas: false,
})

/**
 * Os tipos que precisam da chave da PageSpeed.
 *
 * Derivado aqui e lido pelo worker: uma lista escrita à mão do outro lado
 * ficava para trás no dia em que se acrescentasse uma variante, e o sintoma
 * seria a verificação nova a queixar-se de falta de chave com a chave
 * definida.
 */
export const PAGE_SPEED_TYPES: readonly string[] = [
  pageSpeedCheck.type,
  pageSpeedDesktopCheck.type,
]
