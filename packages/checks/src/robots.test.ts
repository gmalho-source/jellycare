import { describe, expect, it } from 'vitest'
import { buildPolicy, groupFor, isAllowed, parseRobotsTxt } from './robots.js'

describe('parseRobotsTxt', () => {
  it('lê grupos, regras e sitemaps', () => {
    const robots = parseRobotsTxt(`
      User-agent: *
      Disallow: /wp-admin/
      Allow: /wp-admin/admin-ajax.php
      Crawl-delay: 2

      Sitemap: https://cliente.pt/sitemap.xml
    `)

    expect(robots.groups).toHaveLength(1)
    expect(robots.groups[0]?.rules).toHaveLength(2)
    expect(robots.groups[0]?.crawlDelaySeconds).toBe(2)
    expect(robots.sitemaps).toEqual(['https://cliente.pt/sitemap.xml'])
  })

  it('junta user-agents consecutivos no mesmo grupo', () => {
    const robots = parseRobotsTxt(`
      User-agent: Googlebot
      User-agent: Bingbot
      Disallow: /privado/
    `)

    expect(robots.groups).toHaveLength(1)
    expect(robots.groups[0]?.userAgents).toEqual(['googlebot', 'bingbot'])
  })

  it('separa grupos quando um novo user-agent surge depois de regras', () => {
    const robots = parseRobotsTxt(`
      User-agent: *
      Disallow: /a/
      User-agent: Googlebot
      Disallow: /b/
    `)

    expect(robots.groups).toHaveLength(2)
  })

  it('ignora comentários e linhas mal formadas', () => {
    const robots = parseRobotsTxt(`
      # comentário
      User-agent: *   # inline
      Disallow: /x/
      isto não é um campo
    `)

    expect(robots.groups[0]?.rules).toEqual([{ type: 'disallow', pattern: '/x/' }])
  })
})

describe('groupFor', () => {
  const robots = parseRobotsTxt(`
    User-agent: *
    Disallow: /

    User-agent: JellycareBot
    Disallow: /privado/
  `)

  it('prefere a regra dirigida ao nosso nome, mesmo aparecendo depois', () => {
    const group = groupFor(robots, 'JellycareBot/1.0 (+https://jellycare.pt/bot)')
    expect(group?.rules).toEqual([{ type: 'disallow', pattern: '/privado/' }])
  })

  it('cai para o grupo genérico quando não há regra específica', () => {
    const group = groupFor(robots, 'OutroBot/2.0')
    expect(group?.userAgents).toEqual(['*'])
  })

  it('devolve nulo quando não há grupo aplicável', () => {
    const semGenerico = parseRobotsTxt('User-agent: Googlebot\nDisallow: /')
    expect(groupFor(semGenerico, 'JellycareBot/1.0')).toBeNull()
  })
})

describe('isAllowed', () => {
  const group = parseRobotsTxt(`
    User-agent: *
    Disallow: /wp-admin/
    Allow: /wp-admin/admin-ajax.php
    Disallow: /*.pdf$
    Disallow: /privado
  `).groups[0]!

  it('bloqueia o que está em Disallow', () => {
    expect(isAllowed(group, '/wp-admin/options.php')).toBe(false)
  })

  it('deixa passar o Allow mais específico dentro de um Disallow', () => {
    expect(isAllowed(group, '/wp-admin/admin-ajax.php')).toBe(true)
  })

  it('permite o que não está coberto por nenhuma regra', () => {
    expect(isAllowed(group, '/sobre')).toBe(true)
  })

  it('suporta wildcard e âncora de fim', () => {
    expect(isAllowed(group, '/docs/manual.pdf')).toBe(false)
    expect(isAllowed(group, '/docs/manual.pdf?v=2')).toBe(true)
  })

  it('trata o padrão como prefixo, não como caminho exato', () => {
    expect(isAllowed(group, '/privado/ficheiro')).toBe(false)
  })

  it('permite tudo quando não há grupo', () => {
    expect(isAllowed(null, '/qualquer-coisa')).toBe(true)
  })

  it('trata um Disallow vazio como permitir tudo', () => {
    const permissivo = parseRobotsTxt('User-agent: *\nDisallow:').groups[0]!
    expect(isAllowed(permissivo, '/wp-admin/')).toBe(true)
  })
})

describe('buildPolicy', () => {
  it('permite tudo quando não há robots.txt', () => {
    const policy = buildPolicy(null, 'JellycareBot/1.0', 200)
    expect(policy.isAllowed('https://cliente.pt/wp-admin/')).toBe(true)
    expect(policy.crawlDelayMs).toBe(200)
  })

  it('respeita o crawl-delay do site quando é maior que o nosso', () => {
    const policy = buildPolicy('User-agent: *\nCrawl-delay: 5', 'JellycareBot/1.0', 200)
    expect(policy.crawlDelayMs).toBe(5000)
  })

  it('mantém o nosso mínimo quando o site pede menos', () => {
    const policy = buildPolicy('User-agent: *\nCrawl-delay: 0.05', 'JellycareBot/1.0', 200)
    expect(policy.crawlDelayMs).toBe(200)
  })

  it('avalia o caminho com a query string', () => {
    const policy = buildPolicy('User-agent: *\nDisallow: /*?s=', 'JellycareBot/1.0', 0)
    expect(policy.isAllowed('https://cliente.pt/?s=pesquisa')).toBe(false)
    expect(policy.isAllowed('https://cliente.pt/sobre')).toBe(true)
  })
})
