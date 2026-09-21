import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import {
  findInsecureCookies,
  findMixedContent,
  securityHeadersCheck,
  type SecurityHeadersConfig,
} from './security-headers.js'
import { mockFetch, testSite, type MockRoutes } from './test-utils.js'

/** Site exemplar: nada a apontar. Cada teste degrada só o que quer testar. */
const SECURE_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "default-src 'self'",
}

function routes(overrides: MockRoutes = {}): MockRoutes {
  return {
    'https://cliente.pt': { headers: SECURE_HEADERS, body: '<h1>Cliente</h1>' },
    'http://cliente.pt': { status: 301, headers: { location: 'https://cliente.pt' } },
    ...overrides,
  }
}

async function run(routeOverrides: MockRoutes = {}, config: SecurityHeadersConfig = {}) {
  const context: CheckContext = {
    site: testSite,
    now: new Date(),
    fetch: mockFetch(routes(routeOverrides)),
  }
  return runCheck(securityHeadersCheck, context, config)
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code).sort()
}

describe('securityHeadersCheck', () => {
  it('não reporta nada num site bem configurado', async () => {
    const outcome = await run()
    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
  })

  it('reporta cada header em falta', async () => {
    const outcome = await run({
      'https://cliente.pt': { headers: {}, body: '<h1>Cliente</h1>' },
    })

    expect(codes(outcome.findings)).toEqual([
      'missing_content_type_options',
      'missing_csp',
      'missing_frame_protection',
      'missing_hsts',
      'missing_referrer_policy',
    ])
  })

  it('aceita frame-ancestors na CSP em vez de X-Frame-Options', async () => {
    const outcome = await run({
      'https://cliente.pt': {
        headers: { ...SECURE_HEADERS, 'x-frame-options': '', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" },
        body: 'ok',
      },
    })

    expect(codes(outcome.findings)).not.toContain('missing_frame_protection')
  })

  it('respeita a lista de exceções do site', async () => {
    const outcome = await run(
      { 'https://cliente.pt': { headers: {}, body: 'ok' } },
      { ignore: ['missing_csp', 'missing_hsts', 'missing_referrer_policy'] },
    )

    expect(codes(outcome.findings)).toEqual([
      'missing_content_type_options',
      'missing_frame_protection',
    ])
  })

  it('assinala divulgação de versão, mas não o nome do servidor sozinho', async () => {
    const withVersion = await run({
      'https://cliente.pt': { headers: { ...SECURE_HEADERS, server: 'nginx/1.18.0' }, body: 'ok' },
    })
    expect(codes(withVersion.findings)).toContain('server_version_disclosed')

    const withoutVersion = await run({
      'https://cliente.pt': { headers: { ...SECURE_HEADERS, server: 'nginx' }, body: 'ok' },
    })
    expect(codes(withoutVersion.findings)).not.toContain('server_version_disclosed')
  })

  it('deteta que HTTP não redireciona para HTTPS', async () => {
    const outcome = await run({ 'http://cliente.pt': { status: 200, body: 'ok' } })

    const finding = outcome.findings.find((f) => f.code === 'http_not_redirected')
    expect(finding?.severity).toBe('medium')
  })

  it('não reclama quando a porta HTTP está simplesmente fechada', async () => {
    const outcome = await run({
      'http://cliente.pt': { error: Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }) },
    })

    expect(codes(outcome.findings)).not.toContain('http_not_redirected')
  })

  it('gera um finding por recurso em mixed content', async () => {
    const outcome = await run({
      'https://cliente.pt': {
        headers: SECURE_HEADERS,
        body: '<script src="http://cdn.antigo.pt/a.js"></script><img src="http://cdn.antigo.pt/logo.png">',
      },
    })

    const mixed = outcome.findings.filter((f) => f.code === 'mixed_content')
    expect(mixed).toHaveLength(2)
    // O discriminator separa os recursos: corrigir um não fecha o outro.
    expect(mixed.map((f) => f.discriminator).sort()).toEqual([
      'http://cdn.antigo.pt/a.js',
      'http://cdn.antigo.pt/logo.png',
    ])
  })
})

describe('findMixedContent', () => {
  it('apanha recursos ativos e passivos', () => {
    const html = `
      <script src="http://a.pt/x.js"></script>
      <iframe src="http://b.pt/embed"></iframe>
      <img src="http://c.pt/i.png">
      <link rel="stylesheet" href="http://d.pt/s.css">
    `
    expect(findMixedContent(html).sort()).toEqual([
      'http://a.pt/x.js',
      'http://b.pt/embed',
      'http://c.pt/i.png',
      'http://d.pt/s.css',
    ])
  })

  it('ignora links de navegação, que não são mixed content', () => {
    expect(findMixedContent('<a href="http://outro.pt">Outro site</a>')).toEqual([])
  })

  it('ignora um rel canonical em http, que o browser não carrega', () => {
    expect(findMixedContent('<link rel="canonical" href="http://cliente.pt/">')).toEqual([])
  })

  it('não duplica o mesmo recurso repetido na página', () => {
    const html = '<img src="http://a.pt/i.png"><img src="http://a.pt/i.png">'
    expect(findMixedContent(html)).toEqual(['http://a.pt/i.png'])
  })

  it('ignora https', () => {
    expect(findMixedContent('<script src="https://a.pt/x.js"></script>')).toEqual([])
  })
})

describe('findInsecureCookies', () => {
  it('assinala as flags em falta', () => {
    const result = findInsecureCookies(['sessao=abc; Path=/'], true)
    expect(result).toEqual([{ name: 'sessao', missing: ['Secure', 'HttpOnly', 'SameSite'] }])
  })

  it('aceita um cookie completo', () => {
    const result = findInsecureCookies(
      ['sessao=abc; Path=/; Secure; HttpOnly; SameSite=Lax'],
      true,
    )
    expect(result).toEqual([])
  })

  it('não exige Secure num site servido por HTTP', () => {
    const result = findInsecureCookies(['sessao=abc; HttpOnly; SameSite=Lax'], false)
    expect(result).toEqual([])
  })
})
