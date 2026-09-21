import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import type { Severity } from '@jellycare/core'
import { request } from './http.js'

export interface SecurityHeadersConfig {
  timeoutMs?: number
  /** Headers que a equipa decidiu não exigir neste site. */
  ignore?: string[]
}

interface HeaderRule {
  code: string
  header: string
  severity: Severity
  title: string
  detail: string
  /** Só se aplica a sites servidos por HTTPS. */
  httpsOnly?: boolean
}

const HEADER_RULES: HeaderRule[] = [
  {
    code: 'missing_hsts',
    header: 'strict-transport-security',
    severity: 'medium',
    title: 'Falta o header Strict-Transport-Security',
    detail:
      'Sem HSTS, o primeiro pedido de cada visitante pode ser intercetado antes do redirect ' +
      'para HTTPS.',
    httpsOnly: true,
  },
  {
    code: 'missing_content_type_options',
    header: 'x-content-type-options',
    severity: 'low',
    title: 'Falta o header X-Content-Type-Options',
    detail:
      'Sem nosniff, o browser pode interpretar um ficheiro carregado pelo utilizador como script.',
  },
  {
    code: 'missing_referrer_policy',
    header: 'referrer-policy',
    severity: 'low',
    title: 'Falta o header Referrer-Policy',
    detail: 'URLs internos podem vazar para sites externos através do header Referer.',
  },
]

/** Extrai o valor de uma diretiva de uma Content-Security-Policy. */
function cspDirective(csp: string, directive: string): string | null {
  for (const part of csp.split(';')) {
    const trimmed = part.trim()
    if (trimmed.toLowerCase().startsWith(`${directive} `) || trimmed.toLowerCase() === directive) {
      return trimmed.slice(directive.length).trim()
    }
  }
  return null
}

/**
 * Recursos carregados por HTTP numa página servida por HTTPS.
 *
 * Só conta o que o browser bloqueia ou assinala: scripts, folhas de estilo,
 * iframes e imagens. Um link `<a href="http://...">` para outro site não é
 * mixed content e alertar sobre isso seria ruído.
 */
export function findMixedContent(html: string): string[] {
  const found = new Set<string>()
  const pattern =
    /<(script|iframe|img|link|source|video|audio|embed)\b[^>]*?\b(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi

  for (const match of html.matchAll(pattern)) {
    const tag = match[1]?.toLowerCase()
    const url = match[2]
    if (!tag || !url) continue
    // Um <link> só é mixed content quando traz estilos ou outro recurso ativo;
    // um rel="canonical" ou rel="alternate" em http não é.
    if (tag === 'link' && !/rel\s*=\s*["'][^"']*stylesheet/i.test(match[0])) continue
    found.add(url)
  }

  return [...found]
}

/** Cookies sem as flags que impedem roubo de sessão. */
export function findInsecureCookies(
  setCookieHeaders: string[],
  isHttps: boolean,
): { name: string; missing: string[] }[] {
  const results: { name: string; missing: string[] }[] = []

  for (const header of setCookieHeaders) {
    const name = header.split('=')[0]?.trim()
    if (!name) continue
    const lower = header.toLowerCase()
    const missing: string[] = []
    if (isHttps && !/;\s*secure(;|$)/.test(lower)) missing.push('Secure')
    if (!/;\s*httponly(;|$)/.test(lower)) missing.push('HttpOnly')
    if (!/;\s*samesite\s*=/.test(lower)) missing.push('SameSite')
    if (missing.length > 0) results.push({ name, missing })
  }

  return results
}

export const securityHeadersCheck: CheckDefinition<SecurityHeadersConfig> = {
  type: 'security_headers',
  defaultIntervalMinutes: 60 * 24,
  confirmationsRequired: 1,

  async run(context: CheckContext, config: SecurityHeadersConfig): Promise<CheckResult> {
    const findings: ObservedFinding[] = []
    const ignore = new Set(config.ignore ?? [])
    const fetchOptions = {
      timeoutMs: config.timeoutMs ?? 15_000,
      fetchImpl: context.fetch,
      ...(context.signal ? { signal: context.signal } : {}),
    }

    const response = await request(context.site.url, fetchOptions)
    const isHttps = new URL(response.finalUrl).protocol === 'https:'

    for (const rule of HEADER_RULES) {
      if (ignore.has(rule.code)) continue
      if (rule.httpsOnly && !isHttps) continue
      if (response.headers.get(rule.header)) continue
      findings.push({
        code: rule.code,
        severity: rule.severity,
        title: rule.title,
        detail: rule.detail,
        evidence: { header: rule.header },
      })
    }

    const csp = response.headers.get('content-security-policy')
    const xfo = response.headers.get('x-frame-options')

    if (!ignore.has('missing_csp') && !csp) {
      findings.push({
        code: 'missing_csp',
        severity: 'low',
        title: 'Falta uma Content-Security-Policy',
        detail:
          'Uma CSP limita o estrago de um script injetado. É a defesa mais eficaz contra ' +
          'injeção de conteúdo e a mais trabalhosa de afinar.',
      })
    }

    // Clickjacking fica coberto por qualquer uma das duas; exigir ambas seria
    // um falso positivo em sites que já migraram para CSP.
    const hasFrameProtection = Boolean(xfo) || (csp !== null && cspDirective(csp, 'frame-ancestors') !== null)
    if (!ignore.has('missing_frame_protection') && !hasFrameProtection) {
      findings.push({
        code: 'missing_frame_protection',
        severity: 'medium',
        title: 'O site pode ser embebido num iframe por terceiros',
        detail:
          'Sem X-Frame-Options nem frame-ancestors na CSP, o site pode ser usado num ataque de ' +
          'clickjacking.',
      })
    }

    const server = response.headers.get('server')
    const poweredBy = response.headers.get('x-powered-by')
    // Um nome de servidor não é problema; um número de versão é um convite a
    // procurar exploits para essa versão exata.
    const disclosed = [server, poweredBy].filter(
      (value): value is string => typeof value === 'string' && /\d+\.\d+/.test(value),
    )
    if (!ignore.has('server_version_disclosed') && disclosed.length > 0) {
      findings.push({
        code: 'server_version_disclosed',
        severity: 'low',
        title: 'O servidor divulga a versão do software',
        detail: `Headers a expor versões: ${disclosed.join(', ')}.`,
        evidence: { server, poweredBy },
      })
    }

    if (isHttps && !ignore.has('mixed_content')) {
      for (const url of findMixedContent(response.body)) {
        findings.push({
          code: 'mixed_content',
          discriminator: url,
          severity: 'medium',
          title: 'Recurso carregado por HTTP numa página HTTPS',
          detail: `O browser bloqueia ou assinala ${url}.`,
          evidence: { resource: url, page: response.finalUrl },
        })
      }
    }

    if (!ignore.has('insecure_cookie')) {
      const setCookies =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : response.headers.get('set-cookie')
            ? [response.headers.get('set-cookie') as string]
            : []

      for (const cookie of findInsecureCookies(setCookies, isHttps)) {
        findings.push({
          code: 'insecure_cookie',
          discriminator: cookie.name,
          severity: cookie.missing.includes('Secure') ? 'medium' : 'low',
          title: `Cookie "${cookie.name}" sem ${cookie.missing.join(', ')}`,
          detail: 'Cookies de sessão sem estas flags são exploráveis por XSS ou em rede aberta.',
          evidence: { cookie: cookie.name, missing: cookie.missing },
        })
      }
    }

    // Um site que serve HTTPS mas continua a aceitar HTTP sem redirecionar
    // deixa o visitante entrar em claro — e o HSTS acima não o protege no
    // primeiro acesso.
    if (isHttps && !ignore.has('http_not_redirected')) {
      const httpUrl = new URL(context.site.url)
      httpUrl.protocol = 'http:'
      try {
        const plain = await request(httpUrl.toString(), { ...fetchOptions, maxRedirects: 0 })
        const redirectsToHttps =
          plain.status >= 300 &&
          plain.status < 400 &&
          (plain.headers.get('location') ?? '').startsWith('https://')
        if (!redirectsToHttps) {
          findings.push({
            code: 'http_not_redirected',
            severity: 'medium',
            title: 'HTTP não redireciona para HTTPS',
            detail: `http://${context.site.hostname} responde ${plain.status} sem redirecionar.`,
            evidence: { status: plain.status, location: plain.headers.get('location') },
          })
        }
      } catch {
        // HTTP fechado é o comportamento desejado — não é um problema.
      }
    }

    return { findings, metrics: { headersChecked: HEADER_RULES.length } }
  },
}
