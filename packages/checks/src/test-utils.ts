/** Utilitários de teste partilhados pelos checks. Não é exportado no índice. */

export interface MockResponse {
  status?: number
  headers?: Record<string, string | string[]>
  body?: string
  /** Simula uma falha de rede em vez de uma resposta. */
  error?: Error
  /** Atraso artificial, para exercitar limiares de lentidão e timeouts. */
  delayMs?: number
}

export type MockRoutes = Record<string, MockResponse | ((url: string) => MockResponse)>

export interface MockFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
  /** URLs pedidos, pela ordem em que foram pedidos. */
  calls: string[]
}

/**
 * `https://cliente.pt` e `https://cliente.pt/` são o mesmo URL. Normalizar as
 * chaves das rotas evita fixtures a falhar por uma barra final.
 */
function routeKey(url: string): string {
  try {
    return new URL(url).toString()
  } catch {
    return url
  }
}

function buildHeaders(raw: Record<string, string | string[]> = {}): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

class MockAbortError extends Error {
  constructor() {
    super('The operation was aborted')
    this.name = 'AbortError'
  }
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new MockAbortError()
}

/** Espera, ou desiste se o sinal disparar primeiro — como o `fetch` a sério. */
function sleepOrAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      reject(new MockAbortError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * `fetch` falso guiado por um mapa de URL para resposta.
 *
 * Um URL sem rota definida devolve 404 em vez de rebentar: os checks têm de
 * lidar com 404 de forma sensata, e um teste que rebenta por rota em falta
 * esconde esse comportamento.
 */
export function mockFetch(routes: MockRoutes, fallback?: MockResponse): MockFetch {
  const calls: string[] = []
  const normalized = new Map<string, MockResponse | ((url: string) => MockResponse)>(
    Object.entries(routes).map(([url, response]) => [routeKey(url), response]),
  )

  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)

    const route = normalized.get(routeKey(url)) ?? fallback ?? { status: 404, body: 'Not Found' }
    const resolved = typeof route === 'function' ? route(url) : route

    // O sinal é respeitado como o `fetch` a sério o respeita. Um duplo que o
    // ignora faz todos os timeouts dos checks passarem sem serem exercidos:
    // o teste espera o atraso, recebe a resposta, e dá por bom um limite de
    // tempo que nunca chegou a cortar nada.
    if (resolved.delayMs) await sleepOrAbort(resolved.delayMs, init?.signal)
    else throwIfAborted(init?.signal)

    if (resolved.error) throw resolved.error

    return new Response(resolved.body ?? '', {
      status: resolved.status ?? 200,
      headers: buildHeaders(resolved.headers),
    })
  }

  return Object.assign(impl, { calls }) as MockFetch
}

/** Erro de rede do Node, com a `cause.code` que o `classifyNetworkError` lê. */
export function networkError(code: string, message = 'fetch failed'): Error {
  const error = new Error(message)
  ;(error as Error & { cause: { code: string } }).cause = { code }
  return error
}

export const testSite = {
  id: 'site-1',
  organizationId: 'org-1',
  url: 'https://cliente.pt',
  hostname: 'cliente.pt',
  label: 'Cliente',
}
