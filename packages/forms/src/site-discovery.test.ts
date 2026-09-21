import { mockFetch, type MockRoutes } from '@jellycare/checks/test-utils'
import { describe, expect, it } from 'vitest'
import { discoverSiteForms, prioritisePages } from './site-discovery.js'

const HTML = { 'content-type': 'text/html; charset=utf-8' }

const CONTACT_FORM = `
  <form id="contacto" method="post" action="/enviar">
    <input name="nome" required>
    <input name="email" type="email" required>
    <textarea name="mensagem" required></textarea>
    <button type="submit">Enviar</button>
  </form>`

async function discover(routes: MockRoutes, maxPages = 15) {
  return discoverSiteForms({
    siteUrl: 'https://cliente.pt',
    fetchImpl: mockFetch(routes),
    crawlDelayMs: 0,
    maxPages,
  })
}

describe('prioritisePages', () => {
  it('coloca as páginas de contacto à frente', () => {
    const ordered = prioritisePages([
      { url: 'https://cliente.pt/blog' },
      { url: 'https://cliente.pt/contactos' },
      { url: 'https://cliente.pt/sobre' },
    ])

    expect(ordered[0]).toBe('https://cliente.pt/contactos')
  })

  it('usa o texto da âncora quando o caminho não diz nada', () => {
    const ordered = prioritisePages([
      { url: 'https://cliente.pt/p/12' },
      { url: 'https://cliente.pt/p/34', anchorText: 'Peça um orçamento' },
    ])

    expect(ordered[0]).toBe('https://cliente.pt/p/34')
  })

  it('mantém a ordem de descoberta no empate, para o resultado ser estável', () => {
    const ordered = prioritisePages([
      { url: 'https://cliente.pt/a' },
      { url: 'https://cliente.pt/b' },
      { url: 'https://cliente.pt/c' },
    ])

    expect(ordered).toEqual([
      'https://cliente.pt/a',
      'https://cliente.pt/b',
      'https://cliente.pt/c',
    ])
  })

  it('remove duplicados e URLs inválidos', () => {
    const ordered = prioritisePages([
      { url: 'https://cliente.pt/a' },
      { url: 'https://cliente.pt/a' },
      { url: 'nao-e-um-url' },
    ])

    expect(ordered).toEqual(['https://cliente.pt/a'])
  })
})

describe('discoverSiteForms', () => {
  it('encontra o formulário na página de contactos', async () => {
    const result = await discover({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': { headers: HTML, body: '<a href="/contactos">Contactos</a>' },
      'https://cliente.pt/contactos': { headers: HTML, body: CONTACT_FORM },
    })

    expect(result.forms).toHaveLength(1)
    expect(result.forms[0]).toMatchObject({
      kind: 'contact',
      selector: '#contacto',
      pageUrl: 'https://cliente.pt/contactos',
    })
  })

  it('tenta os caminhos habituais mesmo sem link na homepage', async () => {
    const result = await discover({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': { headers: HTML, body: '<h1>Bem-vindo</h1>' },
      'https://cliente.pt/contacto': { headers: HTML, body: CONTACT_FORM },
    })

    expect(result.forms).toHaveLength(1)
    expect(result.forms[0]?.pageUrl).toBe('https://cliente.pt/contacto')
  })

  it('classifica e devolve também os formulários que não serão submetidos', async () => {
    const result = await discover({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': {
        headers: HTML,
        body: `<form method="get"><input name="s" type="search"></form>
               <form class="newsletter" method="post"><input name="email" type="email"></form>`,
      },
    })

    // Ficam no inventário para o cliente ver que os conhecemos, mas com o
    // motivo pelo qual não são testados.
    expect(result.forms.map((form) => form.kind).sort()).toEqual(['newsletter', 'search'])
    expect(result.forms.every((form) => form.excludedReason)).toBe(true)
  })

  it('não repete o mesmo formulário encontrado em páginas diferentes', async () => {
    const rodape = `<form id="contacto"><input name="email" type="email"><textarea name="m"></textarea></form>`
    const result = await discover({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': { headers: HTML, body: `<a href="/sobre">Sobre</a>${rodape}` },
      'https://cliente.pt/sobre': { headers: HTML, body: rodape },
    })

    // O mesmo seletor em páginas diferentes são formulários diferentes: o
    // cliente pode ter partido um sem partir o outro.
    expect(result.forms.map((form) => form.pageUrl).sort()).toEqual([
      'https://cliente.pt/',
      'https://cliente.pt/sobre',
    ])
  })

  it('respeita o orçamento de páginas', async () => {
    const routes: MockRoutes = { 'https://cliente.pt/robots.txt': { status: 404 } }
    const links = Array.from({ length: 30 }, (_, i) => `<a href="/p${i}">Página ${i}</a>`).join('')
    routes['https://cliente.pt/'] = { headers: HTML, body: links }
    for (let i = 0; i < 30; i++) {
      routes[`https://cliente.pt/p${i}`] = { headers: HTML, body: '<h1>Página</h1>' }
    }

    const result = await discover(routes, 5)
    expect(result.pagesVisited).toBe(5)
  })

  it('respeita o robots.txt', async () => {
    const fetch = mockFetch({
      'https://cliente.pt/robots.txt': { body: 'User-agent: *\nDisallow: /contactos' },
      'https://cliente.pt/': { headers: HTML, body: '<a href="/contactos">Contactos</a>' },
      'https://cliente.pt/contactos': { headers: HTML, body: CONTACT_FORM },
    })

    const result = await discoverSiteForms({
      siteUrl: 'https://cliente.pt',
      fetchImpl: fetch,
      crawlDelayMs: 0,
    })

    expect(result.forms).toHaveLength(0)
    expect(fetch.calls).not.toContain('https://cliente.pt/contactos')
  })

  it('conta as páginas que não conseguiu obter sem rebentar', async () => {
    const result = await discover({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': { headers: HTML, body: '<a href="/contactos">Contactos</a>' },
      'https://cliente.pt/contactos': { error: new Error('socket hang up') },
    })

    expect(result.pagesFailed).toBe(1)
    expect(result.forms).toHaveLength(0)
  })

  it('ignora respostas que não são HTML', async () => {
    const result = await discover({
      'https://cliente.pt/robots.txt': { status: 404 },
      'https://cliente.pt/': {
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
      },
    })

    expect(result.forms).toHaveLength(0)
  })

  it('aceita caminhos indicados manualmente', async () => {
    const result = await discoverSiteForms({
      siteUrl: 'https://cliente.pt',
      seedPaths: ['/pedidos/novo'],
      crawlDelayMs: 0,
      fetchImpl: mockFetch({
        'https://cliente.pt/robots.txt': { status: 404 },
        'https://cliente.pt/': { headers: HTML, body: '<h1>Olá</h1>' },
        'https://cliente.pt/pedidos/novo': { headers: HTML, body: CONTACT_FORM },
      }),
    })

    expect(result.forms[0]?.pageUrl).toBe('https://cliente.pt/pedidos/novo')
  })
})
