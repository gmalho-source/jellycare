/**
 * Normalização de URLs.
 *
 * Importa mais do que parece: o URL normalizado é o `discriminator` do
 * fingerprint de um finding. Se `https://site.pt/a` e `https://site.pt/a#top`
 * normalizarem de forma diferente, o mesmo link quebrado gera dois alertas.
 */
export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL
  try {
    url = base ? new URL(input, base) : new URL(input)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  url.hash = ''
  url.hostname = url.hostname.toLowerCase()

  // `new URL` já remove a porta quando é a do protocolo, mas não quando ela
  // vem escrita à mão num href.
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = ''
  }

  if (url.pathname === '') url.pathname = '/'

  return url.toString()
}

/** Hostname sem `www.`, para comparar domínios sem tropeçar no prefixo. */
export function registrableHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

/**
 * O URL pertence ao site? Subdomínios contam como externos: `blog.cliente.pt`
 * costuma ser outro sistema, com outro dono e outro contrato.
 */
export function isInternalUrl(candidate: string, siteUrl: string): boolean {
  try {
    return registrableHost(new URL(candidate).hostname) === registrableHost(new URL(siteUrl).hostname)
  } catch {
    return false
  }
}
