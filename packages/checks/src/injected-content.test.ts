import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import { analisarPagina, injectedContentCheck, PERFIS, type Perfil } from './injected-content.js'
import { testSite } from './test-utils.js'

interface Resposta {
  status?: number
  body?: string
  headers?: Record<string, string>
  error?: Error
}

/**
 * Um `fetch` que responde conforme quem pede: o visitante, o Googlebot ou
 * quem vem da pesquisa. É o que o cloaking faz, e o que os testes têm de
 * conseguir imitar.
 */
function sitePorPerfil(responder: (url: string, perfil: Perfil) => Resposta) {
  const pedidos: { url: string; perfil: Perfil }[] = []
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers = (init?.headers ?? {}) as Record<string, string>
    const perfil: Perfil = headers['user-agent']?.includes('Googlebot')
      ? 'googlebot'
      : headers.referer
        ? 'pesquisa'
        : 'visitante'
    pedidos.push({ url, perfil })
    const resposta = responder(url, perfil)
    if (resposta.error) throw resposta.error
    return new Response(resposta.body ?? '', {
      status: resposta.status ?? 200,
      headers: { 'content-type': 'text/html; charset=utf-8', ...resposta.headers },
    })
  }
  return Object.assign(impl, { pedidos })
}

async function correr(responder: (url: string, perfil: Perfil) => Resposta, additionalUrls?: string[]) {
  const fetch = sitePorPerfil(responder)
  const context: CheckContext = { site: testSite, now: new Date(), fetch: fetch as typeof globalThis.fetch }
  const outcome = await runCheck(injectedContentCheck, context, additionalUrls ? { additionalUrls } : {})
  return { outcome, pedidos: fetch.pedidos }
}

/** Uma página normal, com texto suficiente para se poder comparar. */
const TEXTO =
  'A nossa clínica dentária em Lisboa trata de toda a família desde mil novecentos e noventa. ' +
  'Fazemos consultas de rotina, limpezas, ortodontia com aparelhos fixos e invisíveis, implantes, ' +
  'branqueamento e urgências ao fim de semana. Marque a sua consulta pelo telefone ou pelo formulário ' +
  'e receba confirmação no próprio dia. Trabalhamos com os principais seguros de saúde e acordos ' +
  'com empresas da zona. A equipa é formada por médicos dentistas, higienistas e assistentes com ' +
  'experiência em crianças, adultos e idosos. O consultório fica perto do metro e tem estacionamento ' +
  'gratuito para clientes. Conheça os nossos tratamentos, os preços indicativos e as perguntas frequentes ' +
  'que os pacientes nos fazem antes da primeira visita, incluindo horários alargados durante a semana.'

const pagina = (corpo = '', cabeca = '') =>
  `<!doctype html><html><head><title>Clínica Sorriso</title>${cabeca}</head><body><h1>Clínica Sorriso</h1><p>${TEXTO}</p><a href="/contactos">Contactos</a><a href="https://www.instagram.com/clinicasorriso">Instagram</a>${corpo}</body></html>`

const DOMINIO = 'cliente.pt'

describe('injectedContentCheck — um site saudável', () => {
  it('não acusa nada, e compara as três versões da página', async () => {
    const { outcome, pedidos } = await correr(() => ({ body: pagina() }))

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics).toMatchObject({ pagesAnalysed: 1, comparisons: 2, comparisonsRefused: 0 })
    expect(pedidos.map((p) => p.perfil)).toEqual(['visitante', 'googlebot', 'pesquisa'])
  })

  it('não confunde o noscript do Tag Manager nem um menu escondido com injeção', async () => {
    const corpo =
      '<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-ABC" height="0" width="0" style="display:none;visibility:hidden"></iframe>' +
      '<nav style="display:none"><a href="/servicos">Serviços</a><a href="https://facebook.com/clinica">Facebook</a></nav>'
    const { outcome } = await correr(() => ({ body: pagina(corpo) }))
    expect(outcome.findings).toEqual([])
  })

  it('uma farmácia que vende sildenafil à vista de todos não é spam', async () => {
    // Os termos só acusam quando estão escondidos ou só numa das versões.
    const corpo = '<p>Sildenafil 50 mg, 4 comprimidos. <a href="https://infarmed.pt/sildenafil">Folheto</a></p>'
    const { outcome } = await correr(() => ({ body: pagina(corpo) }))
    expect(outcome.findings).toEqual([])
  })

  it('aceita a página declarada além da homepage, e não mais do que três', async () => {
    const { outcome, pedidos } = await correr(
      () => ({ body: pagina() }),
      ['https://cliente.pt/a', 'https://cliente.pt/b', 'https://cliente.pt/c'],
    )
    expect(outcome.metrics.pagesAnalysed).toBe(3)
    expect(new Set(pedidos.map((p) => p.url)).size).toBe(3)
  })
})

describe('injectedContentCheck — conteúdo injetado', () => {
  it('apanha links de spam escondidos com estilo na própria tag', async () => {
    const corpo =
      '<div style="position:absolute;left:-9999px"><a href="https://farmacia-barata.ru/">buy viagra online</a></div>'
    const { outcome } = await correr(() => ({ body: pagina(corpo) }))

    expect(outcome.findings).toHaveLength(1)
    expect(outcome.findings[0]).toMatchObject({
      code: 'hidden_spam_links',
      severity: 'critical',
      discriminator: 'https://cliente.pt',
    })
    expect(outcome.findings[0]?.evidence?.perfis).toEqual(['visitante', 'pesquisa'])
  })

  it('apanha links escondidos por uma regra no CSS da página', async () => {
    const corpo = '<div class="xq7"><a href="https://slots.example/">Slot gacor hari ini</a></div>'
    const cabeca = '<style>.menu{color:red}.xq7{height:0;overflow:hidden}</style>'
    const analise = analisarPagina(pagina(corpo, cabeca), 'https://cliente.pt/', DOMINIO)
    expect(analise.linksEscondidos).toEqual([{ href: 'https://slots.example/', termo: 'slot gacor' }])
  })

  it('apanha uma moldura invisível para um domínio desconhecido', async () => {
    const corpo = '<iframe src="https://trk.malicioso.top/x" width="1" height="1"></iframe>'
    const { outcome } = await correr(() => ({ body: pagina(corpo) }))
    expect(outcome.findings.map((f) => [f.code, f.severity])).toEqual([['hidden_iframe', 'high']])
    expect(outcome.findings[0]?.evidence?.dominios).toEqual(['malicioso.top'])
  })

  it('apanha os padrões de JavaScript ofuscado do malware em WordPress', () => {
    const casos = [
      "eval(function(p,a,c,k,e,d){e=function(c){return c};return p}('0 1',2,2,'x'.split('|'),0,{}))",
      "eval(atob('ZG9jdW1lbnQubG9jYXRpb249Imh0dHBzOi8vbWFsLnRvcCI='))",
      "document.write(unescape('%3Cscript%20src%3D%22https%3A%2F%2Fmal.top%22%3E'))",
      `var s=document.createElement('script');s.src=String.fromCharCode(${Array.from({ length: 30 }, () => 104).join(',')});`,
    ]
    for (const codigo of casos) {
      const analise = analisarPagina(pagina(`<script>${codigo}</script>`), 'https://cliente.pt/', DOMINIO)
      expect(analise.scriptsOfuscados, codigo).toHaveLength(1)
    }
  })

  it('código minificado normal não é ofuscação', () => {
    const minificado =
      '!function(e,t){"use strict";var n=e.document,r=function(e){return n.querySelector(e)};' +
      'e.dataLayer=e.dataLayer||[];function o(){dataLayer.push(arguments)}o("js",new Date);o("config","G-XYZ")}(window);'
    const analise = analisarPagina(pagina(`<script>${minificado}</script>`), 'https://cliente.pt/', DOMINIO)
    expect(analise.scriptsOfuscados).toEqual([])
    expect(analise.scriptsInline).toBe(1)
  })

  it('uma tabela de caracteres sem nada que a execute não é ofuscação', () => {
    // String.fromCharCode longo aparece em código legítimo, a montar
    // alfabetos ou ícones. Só conta quando o resultado é corrido ou escrito.
    const tabela = `var letras=String.fromCharCode(${Array.from({ length: 26 }, (_, i) => 65 + i).join(',')});`
    const analise = analisarPagina(pagina(`<script>${tabela}</script>`), 'https://cliente.pt/', DOMINIO)
    expect(analise.scriptsOfuscados).toEqual([])
  })

  it('o que só é injetado a quem vem da pesquisa conta como injeção', async () => {
    const injetado = '<script>eval(atob("ZG9jdW1lbnQubG9jYXRpb249Imh0dHBzOi8vbWFsLnRvcCI="))</script>'
    const { outcome } = await correr((_url, perfil) => ({
      body: perfil === 'pesquisa' ? pagina(injetado) : pagina(),
    }))
    const ofuscado = outcome.findings.find((f) => f.code === 'obfuscated_script')
    expect(ofuscado?.evidence?.perfis).toEqual(['pesquisa'])
  })
})

describe('injectedContentCheck — cloaking', () => {
  it('apanha spam servido só ao Googlebot', async () => {
    const spam =
      '<div><a href="https://pharma.example/">Cheap cialis</a> <a href="https://pharma.example/v">viagra without prescription</a></div>'
    const { outcome } = await correr((_url, perfil) => ({
      body: perfil === 'googlebot' ? pagina(spam) : pagina(),
    }))

    expect(outcome.findings).toHaveLength(1)
    expect(outcome.findings[0]).toMatchObject({
      code: 'cloaking_spam',
      severity: 'critical',
      discriminator: 'https://cliente.pt · googlebot',
      title: 'O site mostra ao Google spam que os visitantes não veem',
    })
    expect(outcome.findings[0]?.evidence?.termos).toEqual(['viagra', 'cialis'])
  })

  it('apanha o redirecionamento só para quem chega da pesquisa', async () => {
    const { outcome } = await correr((url, perfil) => {
      if (perfil === 'pesquisa' && url.startsWith('https://cliente.pt')) {
        return { status: 302, headers: { location: 'https://apostas-premium.top/entrar' } }
      }
      return { body: pagina() }
    })

    expect(outcome.findings).toHaveLength(1)
    expect(outcome.findings[0]).toMatchObject({
      code: 'cloaking_redirect',
      severity: 'critical',
      discriminator: 'https://cliente.pt · pesquisa',
    })
    expect(outcome.findings[0]?.detail).toContain('apostas-premium.top')
  })

  it('um redirecionamento para o www do próprio site não é cloaking', async () => {
    const { outcome } = await correr((url, perfil) => {
      if (perfil === 'googlebot' && url === 'https://cliente.pt/') {
        return { status: 301, headers: { location: 'https://www.cliente.pt/' } }
      }
      return { body: pagina() }
    })
    expect(outcome.findings).toEqual([])
  })

  it('assinala uma página muito diferente para o Googlebot, como suspeita e não como certeza', async () => {
    const outra =
      '<!doctype html><html><body><p>' +
      Array.from({ length: 120 }, (_, i) => `termo${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`).join(' ') +
      '</p></body></html>'
    const { outcome } = await correr((_url, perfil) => ({
      body: perfil === 'googlebot' ? outra : pagina(),
    }))
    expect(outcome.findings.map((f) => [f.code, f.severity])).toEqual([['cloaking_content', 'medium']])
  })

  it('um site que recusa o Googlebot falso não é acusado: fica um aviso para a equipa', async () => {
    // A proteção contra robots falsos do Cloudflare e do Wordfence responde
    // 403 a quem diz ser o Googlebot sem vir dos endereços da Google.
    const { outcome } = await correr((_url, perfil) =>
      perfil === 'googlebot' ? { status: 403, body: 'Forbidden' } : { body: pagina() },
    )
    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics).toMatchObject({ comparisons: 1, comparisonsRefused: 1 })
    expect(outcome.warnings?.[0]).toContain('Googlebot')
  })
})

describe('injectedContentCheck — quando não consegue ver', () => {
  it('falha em vez de dar o site por limpo quando nenhuma página responde', async () => {
    // Um run falhado não resolve nada; um run «limpo» fechava uma injeção
    // verdadeira só porque o site esteve em baixo à hora da verificação.
    const { outcome } = await correr(() => ({ status: 503 }))
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('Nenhuma página respondeu')
  })

  it('com uma página em baixo e outra a responder, analisa a que respondeu e avisa da outra', async () => {
    const { outcome } = await correr(
      (url) => (url.includes('/loja') ? { status: 500 } : { body: pagina() }),
      ['https://cliente.pt/loja'],
    )
    expect(outcome.status).toBe('ok')
    expect(outcome.metrics.pagesAnalysed).toBe(1)
    expect(outcome.warnings?.some((aviso) => aviso.includes('/loja'))).toBe(true)
  })

  it('pede como browser e como Googlebot, nunca como JellycareBot', () => {
    // O cloaking esconde-se de quem parece um robot de verificação.
    for (const cabecalhos of Object.values(PERFIS)) {
      expect(cabecalhos['user-agent']).not.toContain('Jellycare')
    }
  })
})
