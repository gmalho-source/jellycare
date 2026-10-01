import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import * as cheerio from 'cheerio'
import { getDomain } from 'tldts'
import { classifyNetworkError, request, type HttpResponse } from './http.js'

export interface InjectedContentConfig {
  /** Páginas além da homepage. As mesmas que se declaram para a reputação. */
  additionalUrls?: string[]
  timeoutMs?: number
}

/** Páginas por site e por passagem. Cada uma custa três pedidos ao site do cliente. */
const MAX_PAGINAS = 3
const MAX_CORPO = 2 * 1024 * 1024

/*
 * Os três perfis de quem pede a página.
 *
 * É o único check que não se apresenta como JellycareBot, e tem de ser assim:
 * um site comprometido mostra o conteúdo limpo a quem parece um robot, e um
 * pedido que diz «sou um verificador» recebia exatamente o conteúdo limpo. Só
 * corre em domínios com a propriedade provada, ou seja, com autorização do
 * dono.
 *
 * Os três são telemóvel, de propósito. Um site pode servir HTML diferente a
 * telemóvel e a computador, e isso é legítimo. Comparando telemóvel com
 * telemóvel, o que muda entre os perfis é só ser o Googlebot ou vir da
 * pesquisa, que é exatamente o que o cloaking usa para decidir.
 */
export const PERFIS = {
  visitante: {
    'user-agent':
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  },
  googlebot: {
    'user-agent':
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
  pesquisa: {
    'user-agent':
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    referer: 'https://www.google.com/',
  },
} as const

export type Perfil = keyof typeof PERFIS

/*
 * Os termos do spam injetado em sites comprometidos: farmácia, casino e
 * apostas, empréstimos, réplicas. Sozinhos não acusam nada. Uma farmácia
 * online pode vender sildenafil, um site de apostas fala de casino. Só contam
 * em dois sítios: num bloco escondido com links para fora, ou numa versão da
 * página que só o Googlebot ou quem vem da pesquisa recebe.
 */
const TERMOS_SPAM = [
  'viagra',
  'cialis',
  'levitra',
  'kamagra',
  'sildenafil',
  'tadalafil',
  'casino online',
  'online casino',
  'slot gacor',
  'situs slot',
  'judi online',
  'togel',
  'sbobet',
  'payday loan',
  'payday loans',
  'replica watches',
  'porn',
  'escort service',
].map((termo) => ({ termo, re: new RegExp(`\\b${termo.replace(/\s+/g, '\\s+')}\\b`, 'i') }))

/** Declarações CSS que escondem um elemento. */
const ESCONDIDO =
  /display\s*:\s*none|visibility\s*:\s*hidden|(?:left|top|text-indent)\s*:\s*-\d{3,}(?:px|em|rem)?|font-size\s*:\s*0(?:px|em|rem)?\s*(?:;|!|$)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|!|$)|(?:height|width)\s*:\s*0(?:px)?\s*(?:;|!|$)/i

/*
 * Domínios que põem iframes invisíveis em sites saudáveis: o noscript do Tag
 * Manager, píxeis de conversão, o reCAPTCHA, o Turnstile. Um iframe escondido
 * para um destes é medição ou proteção, não injeção.
 */
const IFRAMES_CONHECIDOS = new Set([
  'googletagmanager.com',
  'google.com',
  'doubleclick.net',
  'youtube.com',
  'recaptcha.net',
  'gstatic.com',
  'facebook.com',
  'facebook.net',
  'bing.com',
  'linkedin.com',
  'hotjar.com',
  'clarity.ms',
  'hubspot.com',
  'cloudflare.com',
  'stripe.com',
  'paypal.com',
  'tiktok.com',
])

/*
 * Padrões de JavaScript ofuscado que aparecem no malware injetado em
 * WordPress e quase nunca em código legítimo escrito na página. Código
 * minificado não conta: minificar encurta nomes, não esconde o que corre.
 */
const OFUSCACAO: { nome: string; re: RegExp; exige?: RegExp }[] = [
  {
    nome: 'eval de um packer (p,a,c,k,e,d)',
    re: /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/,
  },
  {
    nome: 'eval de texto descodificado',
    re: /eval\s*\(\s*(?:window\.)?(?:atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(/,
  },
  {
    nome: 'document.write de texto codificado',
    re: /document\.write\s*\(\s*(?:unescape|atob|decodeURIComponent)\s*\(/,
  },
  {
    nome: 'String.fromCharCode com dezenas de códigos',
    re: /String\.fromCharCode\s*\(\s*(?:\d+\s*,\s*){20,}/,
    exige: /eval\s*\(|document\.write|new\s+Function|createElement\s*\(\s*['"]script/,
  },
]

/** Mínimo de identificadores `_0x…` para um script contar como passado num ofuscador. */
const MIN_IDENTIFICADORES_0X = 30

export interface AnaliseDaPagina {
  /** Termos de spam em qualquer parte da página: texto, links, título. */
  termosSpam: Set<string>
  /** Links para fora, escondidos, com termos de spam. */
  linksEscondidos: { href: string; termo: string }[]
  /** Domínios de iframes invisíveis para fora do site. */
  iframesEscondidos: string[]
  /** Scripts na página com ofuscação de malware, com o padrão e um excerto. */
  scriptsOfuscados: { padrao: string; excerto: string }[]
  palavras: Set<string>
  scriptsInline: number
}

function dominioDe(url: string): string | null {
  try {
    const host = new URL(url).hostname
    return getDomain(host) ?? host
  } catch {
    return null
  }
}

function termosEm(texto: string): string[] {
  return TERMOS_SPAM.filter(({ re }) => re.test(texto)).map(({ termo }) => termo)
}

/** Classes e ids que o CSS da própria página esconde, só de seletores simples. */
function regrasQueEscondem(css: string): Set<string> {
  const seletores = new Set<string>()
  for (const regra of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!ESCONDIDO.test(regra[2] ?? '')) continue
    for (const seletor of (regra[1] ?? '').split(',')) {
      const limpo = seletor.trim()
      if (/^[.#][\w-]+$/.test(limpo)) seletores.add(limpo)
    }
  }
  return seletores
}

/**
 * O que uma página tem de suspeito, a partir do HTML servido.
 *
 * Exportada para os testes e para quem quiser analisar uma página guardada.
 */
export function analisarPagina(html: string, paginaUrl: string, dominioSite: string): AnaliseDaPagina {
  const $ = cheerio.load(html)
  const regras = regrasQueEscondem(
    $('style')
      .toArray()
      .map((el) => $(el).text())
      .join('\n'),
  )

  const escondido = ($el: ReturnType<typeof $>): boolean =>
    $el
      .add($el.parents())
      .toArray()
      .some((no) => {
        const $no = $(no)
        if ($no.attr('hidden') !== undefined) return true
        const estilo = $no.attr('style')
        if (estilo && ESCONDIDO.test(estilo)) return true
        const id = $no.attr('id')
        if (id && regras.has(`#${id}`)) return true
        return ($no.attr('class') ?? '').split(/\s+/).some((classe) => classe !== '' && regras.has(`.${classe}`))
      })

  const externo = (href: string): string | null => {
    let absoluto: URL
    try {
      absoluto = new URL(href, paginaUrl)
    } catch {
      return null
    }
    if (absoluto.protocol !== 'http:' && absoluto.protocol !== 'https:') return null
    const dominio = getDomain(absoluto.hostname) ?? absoluto.hostname
    return dominio === dominioSite ? null : dominio
  }

  const linksEscondidos: AnaliseDaPagina['linksEscondidos'] = []
  const hrefs: string[] = []
  $('a[href]').each((_, el) => {
    const $el = $(el)
    const href = $el.attr('href') ?? ''
    hrefs.push(href)
    if (!externo(href)) return
    const [termo] = termosEm(`${$el.text()} ${href}`)
    if (termo && escondido($el)) linksEscondidos.push({ href, termo })
  })

  const iframesEscondidos: string[] = []
  $('iframe[src]').each((_, el) => {
    const $el = $(el)
    const dominio = externo($el.attr('src') ?? '')
    if (!dominio || IFRAMES_CONHECIDOS.has(dominio)) return
    const minusculo = ['width', 'height'].some((atributo) => /^\s*[01](?:px)?\s*$/.test($el.attr(atributo) ?? ''))
    if (minusculo || escondido($el)) iframesEscondidos.push(dominio)
  })

  const scriptsOfuscados: AnaliseDaPagina['scriptsOfuscados'] = []
  let scriptsInline = 0
  $('script:not([src])').each((_, el) => {
    const codigo = $(el).text()
    if (codigo.trim() === '') return
    scriptsInline++

    for (const { nome, re, exige } of OFUSCACAO) {
      const encontrado = re.exec(codigo)
      if (!encontrado || (exige && !exige.test(codigo))) continue
      scriptsOfuscados.push({ padrao: nome, excerto: codigo.slice(encontrado.index, encontrado.index + 160) })
      return
    }

    const identificadores = codigo.match(/\b_0x[a-f0-9]{4,}\b/g)?.length ?? 0
    if (identificadores >= MIN_IDENTIFICADORES_0X && /createElement|location|document\.write/.test(codigo)) {
      scriptsOfuscados.push({ padrao: 'código passado num ofuscador', excerto: codigo.slice(0, 160) })
    }
  })

  const titulo = $('title').text()
  $('script, style, noscript, template').remove()
  const texto = $('body').text()
  const termosSpam = new Set(termosEm(`${titulo} ${texto} ${hrefs.join(' ')}`))
  const palavras = new Set(texto.toLowerCase().match(/\p{L}{3,}/gu) ?? [])

  return { termosSpam, linksEscondidos, iframesEscondidos, scriptsOfuscados, palavras, scriptsInline }
}

/** Abaixo disto, a página do Googlebot e a do visitante são páginas diferentes. */
const SEMELHANCA_MINIMA = 0.25
/** Páginas com menos palavras do que isto não dão uma comparação que valha. */
const PALAVRAS_MINIMAS = 80

function semelhanca(a: Set<string>, b: Set<string>): number {
  let comuns = 0
  for (const palavra of a) if (b.has(palavra)) comuns++
  const uniao = a.size + b.size - comuns
  return uniao === 0 ? 1 : comuns / uniao
}

/** A homepage e as páginas declaradas, sem repetidos. */
function paginasParaVerificar(siteUrl: string, adicionais: readonly string[] = []): string[] {
  const vistas = new Set<string>()
  const lista: string[] = []
  for (const url of [siteUrl, ...adicionais]) {
    const chave = url.replace(/\/+$/, '')
    if (vistas.has(chave)) continue
    vistas.add(chave)
    lista.push(url)
  }
  return lista.slice(0, MAX_PAGINAS)
}

type Obtida = { ok: true; resposta: HttpResponse; html: boolean } | { ok: false; motivo: string }

const QUEM: Record<Exclude<Perfil, 'visitante'>, string> = {
  googlebot: 'o Googlebot',
  pesquisa: 'quem chega da pesquisa Google',
}

export const injectedContentCheck: CheckDefinition<InjectedContentConfig> = {
  type: 'injected_content',
  defaultIntervalMinutes: 60 * 24,
  confirmationsRequired: 1,

  async run(context: CheckContext, config: InjectedContentConfig): Promise<CheckResult> {
    const timeoutMs = config.timeoutMs ?? 20_000
    const dominioSite = getDomain(context.site.hostname) ?? context.site.hostname
    const paginas = paginasParaVerificar(context.site.url, config.additionalUrls)

    const obter = async (url: string, perfil: Perfil): Promise<Obtida> => {
      try {
        const resposta = await request(url, {
          timeoutMs,
          maxBodyBytes: MAX_CORPO,
          headers: { ...PERFIS[perfil] },
          fetchImpl: context.fetch,
          ...(context.signal ? { signal: context.signal } : {}),
        })
        if (resposta.status < 200 || resposta.status >= 300) {
          return { ok: false, motivo: `respondeu ${resposta.status}` }
        }
        const tipo = resposta.headers.get('content-type') ?? 'text/html'
        return { ok: true, resposta, html: tipo.includes('html') }
      } catch (error) {
        return { ok: false, motivo: classifyNetworkError(error).message }
      }
    }

    const findings = new Map<string, ObservedFinding>()
    const juntar = (finding: ObservedFinding, perfil: Perfil) => {
      const chave = `${finding.code}|${finding.discriminator}`
      const existente = findings.get(chave)
      if (!existente) {
        findings.set(chave, { ...finding, evidence: { ...finding.evidence, perfis: [perfil] } })
        return
      }
      const perfis = existente.evidence?.perfis as Perfil[]
      if (!perfis.includes(perfil)) perfis.push(perfil)
    }

    const injetado = (analise: AnaliseDaPagina, pagina: string, perfil: Perfil) => {
      if (analise.linksEscondidos.length > 0) {
        juntar(
          {
            code: 'hidden_spam_links',
            discriminator: pagina,
            severity: 'critical',
            title: 'Links de spam escondidos na página',
            detail: `${analise.linksEscondidos.length} ${analise.linksEscondidos.length === 1 ? 'link escondido' : 'links escondidos'} para outros sites, com termos como «${analise.linksEscondidos[0]?.termo}». É a marca de um site comprometido para vender links.`,
            evidence: { pagina, links: analise.linksEscondidos.slice(0, 10) },
          },
          perfil,
        )
      }
      if (analise.iframesEscondidos.length > 0) {
        juntar(
          {
            code: 'hidden_iframe',
            discriminator: pagina,
            severity: 'high',
            title: 'Moldura invisível a carregar outro site',
            detail: `A página carrega, sem se ver, conteúdo de ${[...new Set(analise.iframesEscondidos)].join(', ')}.`,
            evidence: { pagina, dominios: [...new Set(analise.iframesEscondidos)] },
          },
          perfil,
        )
      }
      if (analise.scriptsOfuscados.length > 0) {
        juntar(
          {
            code: 'obfuscated_script',
            discriminator: pagina,
            severity: 'high',
            title: 'Código JavaScript ofuscado na página',
            detail: `Padrão encontrado: ${analise.scriptsOfuscados[0]?.padrao}. Código escrito para esconder o que faz é a forma habitual de injetar redirecionamentos e malware.`,
            evidence: { pagina, scripts: analise.scriptsOfuscados.slice(0, 3) },
          },
          perfil,
        )
      }
    }

    const avisos: string[] = []
    const falhas: string[] = []
    let analisadas = 0
    let comparacoes = 0
    let recusas = 0
    let scriptsInline = 0

    for (const pagina of paginas) {
      const visitante = await obter(pagina, 'visitante')
      if (!visitante.ok) {
        falhas.push(`${pagina}: ${visitante.motivo}`)
        continue
      }
      analisadas++
      if (!visitante.html) continue

      const base = analisarPagina(visitante.resposta.body, visitante.resposta.finalUrl, dominioSite)
      scriptsInline += base.scriptsInline
      injetado(base, pagina, 'visitante')
      const dominioBase = dominioDe(visitante.resposta.finalUrl)

      for (const perfil of ['googlebot', 'pesquisa'] as const) {
        const outra = await obter(pagina, perfil)
        if (!outra.ok) {
          // Muitos sites recusam quem diz ser o Googlebot sem vir dos
          // endereços da Google: é a proteção contra robots falsos do
          // Cloudflare e do Wordfence. Não é cloaking, e não se sabe o que o
          // Googlebot verdadeiro recebe. Fica dito à equipa, não ao cliente.
          recusas++
          avisos.push(`${pagina}: o pedido como ${QUEM[perfil]} ${outra.motivo}; comparação não feita`)
          continue
        }
        comparacoes++

        const dominioFinal = dominioDe(outra.resposta.finalUrl)
        if (dominioFinal && dominioFinal !== dominioBase && dominioFinal !== dominioSite) {
          juntar(
            {
              code: 'cloaking_redirect',
              discriminator: `${pagina} · ${perfil}`,
              severity: 'critical',
              title:
                perfil === 'googlebot'
                  ? 'O site redireciona o Googlebot para outro domínio'
                  : 'O site redireciona quem chega da pesquisa Google para outro domínio',
              detail: `Um visitante normal fica em ${dominioBase}; ${QUEM[perfil]} é enviado para ${dominioFinal}.`,
              evidence: {
                pagina,
                destino: outra.resposta.finalUrl,
                cadeia: outra.resposta.redirectChain,
              },
            },
            perfil,
          )
          continue
        }
        if (!outra.html) continue

        const analise = analisarPagina(outra.resposta.body, outra.resposta.finalUrl, dominioSite)
        // Quem vem da pesquisa é um visitante: o que lhe é injetado é
        // injeção, e conta como tal.
        if (perfil === 'pesquisa') injetado(analise, pagina, perfil)

        const novos = [...analise.termosSpam].filter((termo) => !base.termosSpam.has(termo))
        if (novos.length > 0) {
          juntar(
            {
              code: 'cloaking_spam',
              discriminator: `${pagina} · ${perfil}`,
              severity: 'critical',
              title:
                perfil === 'googlebot'
                  ? 'O site mostra ao Google spam que os visitantes não veem'
                  : 'O site mostra spam a quem chega da pesquisa Google',
              detail: `A versão que ${QUEM[perfil]} recebe tem termos como «${novos.slice(0, 3).join('», «')}», que não aparecem na página de um visitante normal.`,
              evidence: { pagina, termos: novos },
            },
            perfil,
          )
          continue
        }

        if (
          perfil === 'googlebot' &&
          base.palavras.size >= PALAVRAS_MINIMAS &&
          analise.palavras.size >= PALAVRAS_MINIMAS
        ) {
          const indice = semelhanca(base.palavras, analise.palavras)
          if (indice < SEMELHANCA_MINIMA) {
            juntar(
              {
                code: 'cloaking_content',
                discriminator: `${pagina} · ${perfil}`,
                severity: 'medium',
                title: 'O Googlebot recebe uma página muito diferente da dos visitantes',
                detail: `Só ${Math.round(indice * 100)}% das palavras são comuns às duas versões. Pode ser personalização legítima, ou o início de um cloaking. Vale a pena olhar.`,
                evidence: {
                  pagina,
                  semelhanca: Number(indice.toFixed(2)),
                  palavrasVisitante: base.palavras.size,
                  palavrasGooglebot: analise.palavras.size,
                },
              },
              perfil,
            )
          }
        }
      }
    }

    // Sem nenhuma página lida, não se viu nada. Dar o site por limpo fazia a
    // reconciliação fechar uma injeção verdadeira só porque o site esteve
    // em baixo na hora da verificação.
    if (analisadas === 0) {
      throw new Error(`Nenhuma página respondeu: ${falhas.join('; ')}`)
    }

    const todosAvisos = [...falhas.map((falha) => `Página não analisada — ${falha}`), ...avisos]
    return {
      findings: [...findings.values()],
      metrics: {
        pagesAnalysed: analisadas,
        comparisons: comparacoes,
        comparisonsRefused: recusas,
        inlineScripts: scriptsInline,
      },
      ...(todosAvisos.length > 0 ? { warnings: todosAvisos } : {}),
    }
  },
}
