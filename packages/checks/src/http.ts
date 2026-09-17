import { USER_AGENT } from '@jellycare/core'

export interface HttpResponse {
  url: string
  /** URL final depois de seguir redirects. */
  finalUrl: string
  status: number
  headers: Headers
  body: string
  /** Cadeia de redirects percorrida, sem o URL final. */
  redirectChain: string[]
  elapsedMs: number
}

export interface HttpRequestOptions {
  method?: 'GET' | 'HEAD'
  timeoutMs?: number
  maxRedirects?: number
  /** Não ler o corpo — poupa largura de banda em probes e em verificação de links. */
  discardBody?: boolean
  /** Bytes máximos a ler do corpo. Protege contra respostas enormes. */
  maxBodyBytes?: number
  headers?: Record<string, string>
  signal?: AbortSignal
  fetchImpl?: typeof globalThis.fetch
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024

/**
 * Classifica um erro de rede num código estável.
 *
 * Importa para o relatório: "não conseguimos resolver o domínio" e "o
 * certificado é inválido" são problemas diferentes, com responsáveis
 * diferentes, e não podem aparecer os dois como "site em baixo".
 */
export function classifyNetworkError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const cause = (error as { cause?: { code?: string } })?.cause
  const raw = cause?.code ?? ''

  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'timeout', message: 'O pedido excedeu o tempo limite' }
  }
  if (raw === 'ENOTFOUND' || raw === 'EAI_AGAIN') {
    return { code: 'dns_failure', message: 'Não foi possível resolver o domínio' }
  }
  if (raw === 'ECONNREFUSED') {
    return { code: 'connection_refused', message: 'Ligação recusada pelo servidor' }
  }
  if (raw === 'ECONNRESET') {
    return { code: 'connection_reset', message: 'Ligação terminada pelo servidor' }
  }
  if (raw.startsWith('ERR_TLS') || raw.startsWith('CERT_') || raw.startsWith('UNABLE_TO_VERIFY')) {
    return { code: 'tls_failure', message: `Falha TLS: ${raw}` }
  }
  return { code: 'network_error', message }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const body = response.body
  if (!body) return ''

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        total += value.byteLength
      }
    }
  } finally {
    // Truncar sem cancelar deixaria a ligação pendurada até ao timeout.
    await reader.cancel().catch(() => {})
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged.subarray(0, maxBytes))
}

/**
 * Pedido HTTP com identificação, timeout e redirects seguidos manualmente.
 *
 * Os redirects são manuais para que a cadeia fique registada: um site que
 * responde 200 depois de três saltos não é a mesma coisa que um que responde
 * 200 diretamente, e a diferença aparece no relatório.
 */
export async function request(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const {
    method = 'GET',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    discardBody = false,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    fetchImpl = globalThis.fetch,
  } = options

  const startedAt = Date.now()
  const redirectChain: string[] = []
  let currentUrl = url

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    let response: Response
    try {
      response = await fetchImpl(currentUrl, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8',
          ...options.headers,
        },
      })
    } finally {
      clearTimeout(timer)
    }

    const isRedirect = response.status >= 300 && response.status < 400
    const location = response.headers.get('location')

    if (isRedirect && location) {
      if (hop === maxRedirects) {
        throw new HttpError(`Excedido o limite de ${maxRedirects} redirects`, 'too_many_redirects')
      }
      let next: string
      try {
        next = new URL(location, currentUrl).toString()
      } catch {
        throw new HttpError(`Redirect para um destino inválido: ${location}`, 'invalid_redirect')
      }
      if (redirectChain.includes(next) || next === currentUrl) {
        throw new HttpError('Ciclo de redirects detetado', 'redirect_loop')
      }
      redirectChain.push(currentUrl)
      currentUrl = next
      await response.body?.cancel().catch(() => {})
      continue
    }

    const body =
      discardBody || method === 'HEAD' ? '' : await readLimited(response, maxBodyBytes)
    if (discardBody) await response.body?.cancel().catch(() => {})

    return {
      url,
      finalUrl: currentUrl,
      status: response.status,
      headers: response.headers,
      body,
      redirectChain,
      elapsedMs: Date.now() - startedAt,
    }
  }

  throw new HttpError(`Excedido o limite de ${maxRedirects} redirects`, 'too_many_redirects')
}
