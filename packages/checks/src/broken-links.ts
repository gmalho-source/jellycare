import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import { USER_AGENT, isInternalUrl, normalizeUrl } from '@jellycare/core'
import * as cheerio from 'cheerio'
import { classifyNetworkError, request, type HttpResponse } from './http.js'
import { buildPolicy, type RobotsPolicy } from './robots.js'

export interface BrokenLinksConfig {
  /** Orçamento de páginas por run. Define o custo do check e o plano do cliente. */
  maxPages?: number
  /** Pedidos em paralelo contra o site do cliente. Deliberadamente baixo. */
  concurrency?: number
  checkExternal?: boolean
  timeoutMs?: number
  /** Expressões regulares de URLs a não verificar. */
  ignorePatterns?: string[]
  /** Pausa mínima entre pedidos ao mesmo host. */
  crawlDelayMs?: number
}

export interface LinkReference {
  url: string
  /** Página onde o link foi encontrado. */
  foundOn: string
  /** Texto da âncora, ou o alt da imagem. Sem isto ninguém encontra o link. */
  anchorText: string
  kind: 'link' | 'image' | 'script' | 'stylesheet'
}

const ASSET_KINDS = new Set<LinkReference['kind']>(['image', 'script', 'stylesheet'])

/**
 * Extensões que nunca são páginas HTML.
 *
 * Um `<a href="manual.pdf">` só se revela não-HTML depois de descarregado, e
 * um PDF de 40MB descarregado por inteiro é caro para nós e para o alojamento
 * do cliente. Estes URLs continuam a ser verificados como links, com um HEAD.
 */
const NON_PAGE_EXTENSIONS = new Set([
  'pdf', 'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'dmg', 'exe', 'pkg',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'csv',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp', 'tiff',
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'flac',
  'css', 'js', 'mjs', 'json', 'xml', 'rss', 'txt', 'woff', 'woff2', 'ttf', 'eot',
])

export function looksLikePage(url: string): boolean {
  try {
    const { pathname } = new URL(url)
    const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
    const dot = lastSegment.lastIndexOf('.')
    if (dot === -1) return true
    return !NON_PAGE_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase())
  } catch {
    return false
  }
}

/** Extrai links e recursos de uma página. */
export function extractReferences(html: string, pageUrl: string): LinkReference[] {
  const $ = cheerio.load(html)
  const references: LinkReference[] = []

  const push = (
    rawHref: string | undefined,
    kind: LinkReference['kind'],
    anchorText: string,
  ) => {
    if (!rawHref) return
    const trimmed = rawHref.trim()
    // Âncoras internas, mailto:, tel:, javascript: e data: não são navegáveis.
    if (trimmed === '' || trimmed.startsWith('#')) return
    const normalized = normalizeUrl(trimmed, pageUrl)
    if (!normalized) return
    references.push({ url: normalized, foundOn: pageUrl, anchorText: anchorText.trim().slice(0, 120), kind })
  }

  $('a[href]').each((_, element) => {
    const $el = $(element)
    push($el.attr('href'), 'link', $el.text() || $el.attr('aria-label') || '')
  })

  $('img[src]').each((_, element) => {
    const $el = $(element)
    push($el.attr('src'), 'image', $el.attr('alt') || '')
  })

  $('script[src]').each((_, element) => {
    push($(element).attr('src'), 'script', '')
  })

  $('link[rel~="stylesheet"][href]').each((_, element) => {
    push($(element).attr('href'), 'stylesheet', '')
  })

  return references
}

/** A página permite ser seguida pelo crawler? */
export function isFollowable(html: string): boolean {
  const $ = cheerio.load(html)
  const robotsMeta = $('meta[name="robots"], meta[name="googlebot"]').attr('content') ?? ''
  return !/\bnofollow\b/i.test(robotsMeta)
}

export interface UrlStatus {
  status: number | null
  finalUrl: string
  redirectHops: number
  /** Código do erro de rede, quando não houve resposta. */
  errorCode?: string
  errorMessage?: string
}

/**
 * Verifica um URL com o menor custo possível.
 *
 * `HEAD` primeiro porque não transfere corpo, mas muitos servidores respondem
 * 405 ou 403 a `HEAD` e serviriam o `GET` sem problema — tratar isso como link
 * quebrado seria o falso positivo mais comum deste check.
 */
export async function probeUrl(
  url: string,
  options: { timeoutMs: number; fetchImpl: typeof globalThis.fetch },
): Promise<UrlStatus> {
  const base = { timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl, discardBody: true }

  try {
    const head = await request(url, { ...base, method: 'HEAD' })
    if (head.status !== 405 && head.status !== 403 && head.status !== 501) {
      return { status: head.status, finalUrl: head.finalUrl, redirectHops: head.redirectChain.length }
    }
  } catch {
    // Cai para GET: o erro pode ser específico do método.
  }

  try {
    const get = await request(url, { ...base, method: 'GET', maxBodyBytes: 4096 })
    return { status: get.status, finalUrl: get.finalUrl, redirectHops: get.redirectChain.length }
  } catch (error) {
    const { code, message } = classifyNetworkError(error)
    return { status: null, finalUrl: url, redirectHops: 0, errorCode: code, errorMessage: message }
  }
}

/**
 * Um estado HTTP que representa mesmo um link partido?
 *
 * 401, 403 e 429 ficam de fora de propósito: conteúdo protegido e rate limiting
 * são respostas normais a um bot, não links partidos. Reportá-los enche o
 * relatório de coisas que o cliente não pode corrigir.
 */
export function isBrokenStatus(status: number | null): boolean {
  if (status === null) return true
  if (status === 401 || status === 403 || status === 429) return false
  return status >= 400
}

interface CrawlState {
  visited: Set<string>
  queue: string[]
  /** Cache de estado por URL: o mesmo link no rodapé de 50 páginas é um pedido. */
  statuses: Map<string, UrlStatus>
  references: Map<string, LinkReference>
  pagesCrawled: number
}

async function fetchRobots(
  siteUrl: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
  defaultDelayMs: number,
): Promise<RobotsPolicy> {
  try {
    const response = await request(new URL('/robots.txt', siteUrl).toString(), {
      timeoutMs,
      fetchImpl,
      maxBodyBytes: 512 * 1024,
    })
    const usable = response.status >= 200 && response.status < 300
    return buildPolicy(usable ? response.body : null, USER_AGENT, defaultDelayMs)
  } catch {
    return buildPolicy(null, USER_AGENT, defaultDelayMs)
  }
}

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve())

export const brokenLinksCheck: CheckDefinition<BrokenLinksConfig> = {
  type: 'broken_links',
  defaultIntervalMinutes: 60 * 24 * 7,
  // Links externos falham por rate limit e por indisponibilidade momentânea.
  // Duas observações antes de incomodar o cliente.
  confirmationsRequired: 2,

  async run(context: CheckContext, config: BrokenLinksConfig): Promise<CheckResult> {
    const maxPages = config.maxPages ?? 100
    const concurrency = Math.max(1, config.concurrency ?? 3)
    const checkExternal = config.checkExternal ?? true
    const timeoutMs = config.timeoutMs ?? 15_000
    const crawlDelayMs = config.crawlDelayMs ?? 200
    const ignore = (config.ignorePatterns ?? []).map((pattern) => new RegExp(pattern))

    const policy = await fetchRobots(context.site.url, context.fetch, timeoutMs, crawlDelayMs)

    const start = normalizeUrl(context.site.url)
    if (!start) throw new Error(`URL do site inválido: ${context.site.url}`)

    const state: CrawlState = {
      visited: new Set(),
      queue: [start],
      statuses: new Map(),
      references: new Map(),
      pagesCrawled: 0,
    }

    const shouldIgnore = (url: string) => ignore.some((pattern) => pattern.test(url))

    // Fase 1 — percorrer as páginas internas e recolher todas as referências.
    while (state.queue.length > 0 && state.pagesCrawled < maxPages) {
      const pageUrl = state.queue.shift() as string
      if (state.visited.has(pageUrl)) continue
      state.visited.add(pageUrl)

      if (!policy.isAllowed(pageUrl)) continue

      let response: HttpResponse
      try {
        response = await request(pageUrl, { timeoutMs, fetchImpl: context.fetch })
      } catch {
        continue
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('html')) continue
      if (response.status < 200 || response.status >= 300) continue

      // Contado só aqui: a métrica é "páginas HTML analisadas", não "pedidos".
      state.pagesCrawled++

      const follow = isFollowable(response.body)

      for (const reference of extractReferences(response.body, response.finalUrl)) {
        if (shouldIgnore(reference.url)) continue

        const internal = isInternalUrl(reference.url, context.site.url)
        if (!internal && !checkExternal) continue

        // A primeira página onde o link aparece é a que fica no relatório —
        // é tão boa como qualquer outra e mantém o finding estável entre runs.
        if (!state.references.has(reference.url)) state.references.set(reference.url, reference)

        if (
          internal &&
          follow &&
          reference.kind === 'link' &&
          looksLikePage(reference.url) &&
          !state.visited.has(reference.url) &&
          state.visited.size + state.queue.length < maxPages
        ) {
          state.queue.push(reference.url)
        }
      }

      await sleep(policy.crawlDelayMs)
    }

    // Fase 2 — verificar cada URL distinto uma única vez.
    const targets = [...state.references.keys()]
    for (let index = 0; index < targets.length; index += concurrency) {
      const batch = targets.slice(index, index + concurrency)
      await Promise.all(
        batch.map(async (url) => {
          state.statuses.set(url, await probeUrl(url, { timeoutMs, fetchImpl: context.fetch }))
        }),
      )
      await sleep(policy.crawlDelayMs)
    }

    // Fase 3 — transformar em findings.
    const findings: ObservedFinding[] = []

    for (const [url, status] of state.statuses) {
      const reference = state.references.get(url)
      if (!reference) continue

      const internal = isInternalUrl(url, context.site.url)
      const isAsset = ASSET_KINDS.has(reference.kind)

      if (isBrokenStatus(status.status)) {
        const label = status.status === null ? status.errorMessage : `HTTP ${status.status}`
        findings.push({
          code: isAsset ? 'asset_missing' : 'link_broken',
          discriminator: url,
          // Um recurso em falta parte a apresentação da página; um link
          // externo partido é um incómodo. A severidade acompanha isso.
          severity: isAsset || internal ? 'medium' : 'low',
          title: isAsset
            ? `${reference.kind === 'image' ? 'Imagem' : 'Recurso'} em falta: ${label}`
            : `Link quebrado: ${label}`,
          detail:
            `${url} está referenciado em ${reference.foundOn}` +
            (reference.anchorText ? ` no texto "${reference.anchorText}"` : '') +
            '.',
          evidence: {
            url,
            foundOn: reference.foundOn,
            anchorText: reference.anchorText,
            kind: reference.kind,
            status: status.status,
            error: status.errorCode,
          },
        })
        continue
      }

      if (status.redirectHops >= 3) {
        findings.push({
          code: 'redirect_chain_long',
          discriminator: url,
          severity: 'low',
          title: `Cadeia de ${status.redirectHops} redirects`,
          detail: `${url} chega a ${status.finalUrl} ao fim de ${status.redirectHops} saltos. Custa tempo de carregamento e dilui sinal de SEO.`,
          evidence: { url, finalUrl: status.finalUrl, hops: status.redirectHops },
        })
      }
    }

    return {
      findings,
      metrics: {
        pagesCrawled: state.pagesCrawled,
        urlsChecked: state.statuses.size,
        brokenCount: findings.filter((f) => f.code !== 'redirect_chain_long').length,
      },
    }
  },
}
