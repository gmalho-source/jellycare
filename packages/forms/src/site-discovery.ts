import { buildPolicy, extractReferences, looksLikePage, request } from '@jellycare/checks'
import { USER_AGENT, isInternalUrl, normalizeUrl } from '@jellycare/core'
import { discoverForms, type DiscoveredForm } from './discovery.js'

/**
 * Descoberta de formulários ao nível do site.
 *
 * O orçamento de páginas é pequeno de propósito: visitar o site inteiro para
 * encontrar o formulário de contacto é caro para nós e para o alojamento do
 * cliente. A prioridade das páginas é que faz o trabalho — um site típico tem
 * o formulário na página de contactos, e é lá que se começa.
 */

export interface DiscoveredSiteForm extends DiscoveredForm {
  pageUrl: string
}

export interface SiteFormDiscoveryOptions {
  siteUrl: string
  /** Páginas HTML efetivamente analisadas. */
  maxPages?: number
  /**
   * Teto absoluto de pedidos. Os caminhos habituais são palpites baratos que
   * quase sempre dão 404; sem um teto próprio, um site que responda 404 a tudo
   * faria pedidos sem fim, e sem os separar do orçamento de páginas eles
   * gastavam-no antes de chegarmos a um único link real.
   */
  maxRequests?: number
  timeoutMs?: number
  crawlDelayMs?: number
  fetchImpl?: typeof globalThis.fetch
  /** Caminhos indicados manualmente, visitados antes de tudo o resto. */
  seedPaths?: string[]
}

export interface SiteFormDiscoveryResult {
  forms: DiscoveredSiteForm[]
  /**
   * URLs das páginas HTML efetivamente analisadas, incluindo as que não tinham
   * formulário nenhum. É o que permite distinguir "o formulário desapareceu"
   * de "não chegámos a visitar a página".
   */
  parsedPages: string[]
  /** Páginas HTML analisadas. */
  pagesVisited: number
  /** Pedidos feitos ao site, incluindo os que deram 404. */
  requestsMade: number
  /** Páginas que não foi possível obter. */
  pagesFailed: number
  /**
   * Páginas que se chegou a pedir, tenham sido analisadas ou não.
   *
   * É o que distingue "esta página falhou" de "nunca chegámos a esta página
   * porque o orçamento acabou". As duas parecem iguais olhando só para o que
   * foi analisado, e tratar a segunda como a primeira inventa problemas que
   * não existem.
   */
  attemptedPages: string[]
  /** Páginas pedidas que não deram HTML utilizável: erro, não-2xx ou outro tipo. */
  failedPages: string[]
}

/** Caminhos onde um formulário de contacto costuma estar, em PT e EN. */
const COMMON_CONTACT_PATHS = [
  '/contacto',
  '/contactos',
  '/contato',
  '/contatos',
  '/contact',
  '/contact-us',
  '/contacte-nos',
  '/fale-connosco',
  '/fale-conosco',
  '/orcamento',
  '/pedido-de-orcamento',
  '/pedir-orcamento',
  '/quote',
  '/suporte',
  '/support',
  '/apoio-ao-cliente',
]

const CONTACT_SIGNAL =
  /(contact|contacto|contato|orcamento|orçamento|quote|fale-c|suporte|support|apoio|pedido|enquiry)/i

/**
 * Ordena candidatos de forma a gastar o orçamento onde há mais probabilidade
 * de existir um formulário de contacto.
 */
export function prioritisePages(
  candidates: readonly { url: string; anchorText?: string }[],
): string[] {
  const seen = new Set<string>()
  const scored: { url: string; score: number; order: number }[] = []

  candidates.forEach((candidate, order) => {
    if (seen.has(candidate.url)) return
    seen.add(candidate.url)

    let score = 0
    try {
      if (CONTACT_SIGNAL.test(new URL(candidate.url).pathname)) score += 2
    } catch {
      return
    }
    if (candidate.anchorText && CONTACT_SIGNAL.test(candidate.anchorText)) score += 1

    scored.push({ url: candidate.url, score, order })
  })

  // Empate resolvido pela ordem de descoberta: mantém o resultado estável
  // entre execuções, o que mantém estáveis os findings que dele dependem.
  scored.sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.order - b.order))
  return scored.map((entry) => entry.url)
}

/** Um URL nunca contém quebra de linha, por isso serve de separador seguro. */
const FORM_KEY_SEPARATOR = '\n'

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

export async function discoverSiteForms(
  options: SiteFormDiscoveryOptions,
): Promise<SiteFormDiscoveryResult> {
  const maxPages = options.maxPages ?? 15
  // Os palpites são um custo fixo, não parte do orçamento de páginas: se
  // entrassem no mesmo saco, um `maxPages` pequeno era gasto antes de chegarmos
  // a um único link real do site.
  const maxRequests =
    options.maxRequests ??
    maxPages + COMMON_CONTACT_PATHS.length + (options.seedPaths?.length ?? 0) + 5
  const timeoutMs = options.timeoutMs ?? 15_000
  const crawlDelayMs = options.crawlDelayMs ?? 200
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  const home = normalizeUrl(options.siteUrl)
  if (!home) throw new Error(`URL do site inválido: ${options.siteUrl}`)

  let policy
  try {
    const robots = await request(new URL('/robots.txt', home).toString(), {
      timeoutMs,
      fetchImpl,
      maxBodyBytes: 512 * 1024,
    })
    const usable = robots.status >= 200 && robots.status < 300
    policy = buildPolicy(usable ? robots.body : null, USER_AGENT, crawlDelayMs)
  } catch {
    policy = buildPolicy(null, USER_AGENT, crawlDelayMs)
  }

  const requested = new Set<string>()
  const parsedPages = new Set<string>()
  const forms = new Map<string, DiscoveredSiteForm>()
  const failedPages = new Set<string>()
  let pagesFailed = 0

  // A homepage primeiro — traz os links de navegação —, depois os caminhos
  // indicados à mão e os habituais, e só então o que se descobrir a partir dali.
  const seeds = [
    home,
    ...(options.seedPaths ?? []).map((path) => normalizeUrl(path, home)),
    ...COMMON_CONTACT_PATHS.map((path) => normalizeUrl(path, home)),
  ].filter((url): url is string => url !== null)

  const queue: string[] = [...new Set(seeds)]
  let discoveredFromLinks = false

  while (queue.length > 0 && parsedPages.size < maxPages && requested.size < maxRequests) {
    const pageUrl = queue.shift() as string
    if (requested.has(pageUrl)) continue
    if (!policy.isAllowed(pageUrl)) continue
    requested.add(pageUrl)

    let response
    try {
      response = await request(pageUrl, { timeoutMs, fetchImpl })
    } catch {
      pagesFailed++
      failedPages.add(pageUrl)
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      failedPages.add(pageUrl)
      continue
    }
    if (!(response.headers.get('content-type') ?? '').includes('html')) {
      failedPages.add(pageUrl)
      continue
    }

    parsedPages.add(response.finalUrl)

    for (const form of discoverForms(response.body, response.finalUrl)) {
      const key = [response.finalUrl, form.selector].join(FORM_KEY_SEPARATOR)
      if (!forms.has(key)) forms.set(key, { ...form, pageUrl: response.finalUrl })
    }

    // Os links da homepage entram uma única vez, já ordenados por relevância.
    if (!discoveredFromLinks && pageUrl === home) {
      discoveredFromLinks = true
      const candidates = extractReferences(response.body, response.finalUrl)
        .filter(
          (reference) =>
            reference.kind === 'link' &&
            isInternalUrl(reference.url, home) &&
            looksLikePage(reference.url) &&
            !requested.has(reference.url),
        )
        .map((reference) => ({ url: reference.url, anchorText: reference.anchorText }))

      queue.push(...prioritisePages(candidates))
    }

    await sleep(policy.crawlDelayMs)
  }

  return {
    forms: [...forms.values()],
    parsedPages: [...parsedPages],
    pagesVisited: parsedPages.size,
    requestsMade: requested.size,
    pagesFailed,
    attemptedPages: [...requested],
    failedPages: [...failedPages],
  }
}
