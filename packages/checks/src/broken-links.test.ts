import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import {
  brokenLinksCheck,
  extractReferences,
  isBrokenStatus,
  isFollowable,
  probeUrl,
  type BrokenLinksConfig,
} from './broken-links.js'
import { mockFetch, testSite, type MockFetch, type MockRoutes } from './test-utils.js'

const HTML = { 'content-type': 'text/html; charset=utf-8' }

async function run(routes: MockRoutes, config: BrokenLinksConfig = {}) {
  const fetch = mockFetch(routes)
  const context: CheckContext = { site: testSite, now: new Date(), fetch }
  const outcome = await runCheck(brokenLinksCheck, context, { crawlDelayMs: 0, ...config })
  return { outcome, fetch }
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code).sort()
}

describe('extractReferences', () => {
  it('recolhe links, imagens, scripts e folhas de estilo', () => {
    const references = extractReferences(
      `<a href="/sobre">Sobre nós</a>
       <img src="/logo.png" alt="Logótipo">
       <script src="/app.js"></script>
       <link rel="stylesheet" href="/estilo.css">`,
      'https://cliente.pt/',
    )

    expect(references.map((r) => r.kind).sort()).toEqual(['image', 'link', 'script', 'stylesheet'])
    expect(references[0]).toMatchObject({
      url: 'https://cliente.pt/sobre',
      anchorText: 'Sobre nós',
      foundOn: 'https://cliente.pt/',
    })
  })

  it('resolve URLs relativos contra a página atual', () => {
    const references = extractReferences('<a href="../contactos">C</a>', 'https://cliente.pt/a/b/')
    expect(references[0]?.url).toBe('https://cliente.pt/a/contactos')
  })

  it('ignora âncoras, mailto, tel e javascript', () => {
    const references = extractReferences(
      `<a href="#topo">Topo</a>
       <a href="mailto:geral@cliente.pt">Email</a>
       <a href="tel:+351210000000">Telefone</a>
       <a href="javascript:void(0)">Nada</a>`,
      'https://cliente.pt/',
    )
    expect(references).toEqual([])
  })

  it('guarda o alt da imagem para o relatório', () => {
    const references = extractReferences('<img src="/x.png" alt="Equipa">', 'https://cliente.pt/')
    expect(references[0]?.anchorText).toBe('Equipa')
  })

  it('ignora um rel preload que não é folha de estilo', () => {
    const references = extractReferences(
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      'https://cliente.pt/',
    )
    expect(references).toEqual([])
  })
})

describe('isFollowable', () => {
  it('respeita meta robots nofollow', () => {
    expect(isFollowable('<meta name="robots" content="noindex, nofollow">')).toBe(false)
    expect(isFollowable('<meta name="robots" content="index, follow">')).toBe(true)
    expect(isFollowable('<html></html>')).toBe(true)
  })
})

describe('isBrokenStatus', () => {
  it('considera 4xx e 5xx quebrados', () => {
    expect(isBrokenStatus(404)).toBe(true)
    expect(isBrokenStatus(410)).toBe(true)
    expect(isBrokenStatus(500)).toBe(true)
  })

  it('não considera quebrado o que é apenas protegido ou limitado', () => {
    // Um bot a levar 403 ou 429 não significa que o link está partido para o
    // visitante. Reportar isto enche o relatório de ruído incorrigível.
    expect(isBrokenStatus(401)).toBe(false)
    expect(isBrokenStatus(403)).toBe(false)
    expect(isBrokenStatus(429)).toBe(false)
  })

  it('considera quebrado quando não houve resposta', () => {
    expect(isBrokenStatus(null)).toBe(true)
  })
})

describe('probeUrl', () => {
  it('usa HEAD quando o servidor colabora', async () => {
    const fetch = mockFetch({ 'https://externo.pt/a': { status: 200 } })
    const status = await probeUrl('https://externo.pt/a', { timeoutMs: 1000, fetchImpl: fetch })

    expect(status.status).toBe(200)
    expect(fetch.calls).toHaveLength(1)
  })

  it('cai para GET quando o servidor rejeita HEAD', async () => {
    let seenHead = false
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        seenHead = true
        return new Response('', { status: 405 })
      }
      return new Response('ok', { status: 200 })
    }) as typeof globalThis.fetch

    const status = await probeUrl('https://externo.pt/a', { timeoutMs: 1000, fetchImpl: fetch })

    // O falso positivo mais comum deste check: servidores que respondem 405 a
    // HEAD e 200 a GET.
    expect(seenHead).toBe(true)
    expect(status.status).toBe(200)
  })

  it('devolve o erro de rede classificado', async () => {
    const error = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    const fetch = mockFetch({ 'https://naoexiste.pt/': { error } })
    const status = await probeUrl('https://naoexiste.pt/', { timeoutMs: 1000, fetchImpl: fetch })

    expect(status.status).toBeNull()
    expect(status.errorCode).toBe('dns_failure')
  })
})

describe('brokenLinksCheck', () => {
  it('percorre o site e não reporta nada quando está tudo bem', async () => {
    const { outcome } = await run({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': {
        headers: HTML,
        body: '<a href="/sobre">Sobre</a><img src="/logo.png" alt="Logo">',
      },
      'https://cliente.pt/sobre': { headers: HTML, body: '<a href="/">Início</a>' },
      'https://cliente.pt/logo.png': { headers: { 'content-type': 'image/png' } },
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.pagesCrawled).toBe(2)
  })

  it('reporta um link interno quebrado com a página de origem e a âncora', async () => {
    const { outcome } = await run({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': { headers: HTML, body: '<a href="/antiga">Página antiga</a>' },
      'https://cliente.pt/antiga': { status: 404 },
    })

    expect(codes(outcome.findings)).toEqual(['link_broken'])
    expect(outcome.findings[0]?.evidence).toMatchObject({
      foundOn: 'https://cliente.pt/',
      anchorText: 'Página antiga',
      status: 404,
    })
  })

  it('distingue recurso em falta de link quebrado', async () => {
    const { outcome } = await run({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': { headers: HTML, body: '<img src="/sumiu.png" alt="Equipa">' },
      'https://cliente.pt/sumiu.png': { status: 404 },
    })

    expect(outcome.findings[0]?.code).toBe('asset_missing')
    expect(outcome.findings[0]?.severity).toBe('medium')
  })

  it('dá menos severidade a um link externo partido do que a um interno', async () => {
    const { outcome } = await run({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': {
        headers: HTML,
        body: '<a href="https://externo.pt/x">Externo</a><a href="/interno">Interno</a>',
      },
      'https://externo.pt/x': { status: 404 },
      'https://cliente.pt/interno': { status: 404 },
    })

    const externo = outcome.findings.find((f) => f.discriminator === 'https://externo.pt/x')
    const interno = outcome.findings.find((f) => f.discriminator === 'https://cliente.pt/interno')
    expect(externo?.severity).toBe('low')
    expect(interno?.severity).toBe('medium')
  })

  it('verifica cada URL uma só vez, mesmo repetido em várias páginas', async () => {
    const menu = '<a href="/a">A</a><a href="/b">B</a><a href="/rodape">Rodapé</a>'
    const { outcome, fetch } = await run({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': { headers: HTML, body: menu },
      'https://cliente.pt/a': { headers: HTML, body: menu },
      'https://cliente.pt/b': { headers: HTML, body: menu },
      'https://cliente.pt/rodape': { headers: HTML, body: menu },
    })

    // Três URLs distintos no menu, repetidos nas quatro páginas. Sem cache
    // seriam doze verificações contra o servidor do cliente.
    expect(outcome.metrics.pagesCrawled).toBe(4)
    expect(outcome.metrics.urlsChecked).toBe(3)
    const probes = fetch.calls.filter((url) => url !== 'https://cliente.pt/robots.txt')
    expect(probes.length).toBeLessThanOrEqual(8)
  })

  it('respeita o robots.txt do cliente', async () => {
    const { outcome, fetch } = await run({
      'https://cliente.pt/robots.txt': { body: 'User-agent: *\nDisallow: /privado/' },
      'https://cliente.pt/': { headers: HTML, body: '<a href="/privado/x">Privado</a>' },
      'https://cliente.pt/privado/x': { headers: HTML, body: 'segredo' },
    })

    // O URL não é rastreado como página. Continua a ser verificado como link,
    // que é um pedido só e é o que o cliente espera de um verificador de links.
    expect(outcome.metrics.pagesCrawled).toBe(1)
    expect(fetch.calls.filter((url) => url === 'https://cliente.pt/privado/x')).toHaveLength(1)
  })

  it('respeita o orçamento de páginas', async () => {
    const routes: MockRoutes = { 'https://cliente.pt/robots.txt': { status: 404 } }
    for (let i = 0; i < 30; i++) {
      routes[`https://cliente.pt/p${i}`] = {
        headers: HTML,
        body: `<a href="/p${i + 1}">Seguinte</a>`,
      }
    }
    routes['https://cliente.pt/'] = { headers: HTML, body: '<a href="/p0">Início</a>' }

    const { outcome } = await run(routes, { maxPages: 5 })
    expect(outcome.metrics.pagesCrawled).toBe(5)
  })

  it('não segue páginas marcadas com nofollow', async () => {
    const { outcome } = await run({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': {
        headers: HTML,
        body: '<meta name="robots" content="nofollow"><a href="/sobre">Sobre</a>',
      },
      'https://cliente.pt/sobre': { headers: HTML, body: 'ok' },
    })

    expect(outcome.metrics.pagesCrawled).toBe(1)
  })

  it('reporta cadeias de redirect longas', async () => {
    const { outcome } = await run({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': { headers: HTML, body: '<a href="/velho">Velho</a>' },
      'https://cliente.pt/velho': { status: 301, headers: { location: '/v2' } },
      'https://cliente.pt/v2': { status: 301, headers: { location: '/v3' } },
      'https://cliente.pt/v3': { status: 301, headers: { location: '/novo' } },
      'https://cliente.pt/novo': { status: 200 },
    })

    expect(codes(outcome.findings)).toEqual(['redirect_chain_long'])
    expect(outcome.findings[0]?.evidence).toMatchObject({ hops: 3 })
  })

  it('não verifica links externos quando desligado', async () => {
    const { outcome, fetch } = await run(
      {
        'https://cliente.pt/robots.txt': { status: 404 },
        'https://cliente.pt/': { headers: HTML, body: '<a href="https://externo.pt/x">E</a>' },
      },
      { checkExternal: false },
    )

    expect(outcome.findings).toEqual([])
    expect(fetch.calls).not.toContain('https://externo.pt/x')
  })

  it('respeita padrões a ignorar', async () => {
    const { outcome } = await run(
      {
        'https://cliente.pt/robots.txt': { status: 404 },
        'https://cliente.pt/': {
          headers: HTML,
          body: '<a href="https://linkedin.com/in/x">LinkedIn</a>',
        },
        'https://linkedin.com/in/x': { status: 999 },
      },
      { ignorePatterns: ['linkedin\\.com'] },
    )

    expect(outcome.findings).toEqual([])
  })

  it('não trata conteúdo não-HTML como página a rastrear', async () => {
    const { outcome } = await run({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': { headers: HTML, body: '<a href="/manual.pdf">Manual</a>' },
      'https://cliente.pt/manual.pdf': { headers: { 'content-type': 'application/pdf' }, body: '%PDF' },
    })

    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.pagesCrawled).toBe(1)
  })

  it('exige duas observações antes de notificar', () => {
    expect(brokenLinksCheck.confirmationsRequired).toBe(2)
  })
})
