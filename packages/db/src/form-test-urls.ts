import { normalizeUrl } from '@jellycare/core'

/**
 * Os URLs onde o administrador declara existirem formulários a testar.
 *
 * O teste de formulários preenche campos e carrega em botões no site de um
 * cliente. Deixar a heurística decidir onde é que isso acontece foi um erro:
 * ela tanto submete um formulário que ninguém queria submetido como ignora o
 * único que interessa. A decisão passa a ser de quem responde pelo site.
 */

/**
 * Quantas páginas se aceitam.
 *
 * Três não é um número mágico — é o que cobre o caso real (contacto, pedido
 * de orçamento, marcação) sem transformar isto num rastreio disfarçado.
 */
export const MAX_FORM_TEST_URLS = 3

export interface FormTestUrlsResult {
  urls: string[]
  /** O que foi recusado, e porquê, para o painel poder dizê-lo. */
  rejected: { input: string; reason: string }[]
}

/**
 * Valida e normaliza a lista.
 *
 * Um URL de outro domínio é recusado e não ignorado em silêncio: quem o
 * escreveu ou se enganou no site, ou estava a pedir-nos para submeter
 * formulários em casa alheia. Nenhuma das duas merece um encolher de ombros.
 */
export function parseFormTestUrls(inputs: readonly string[], siteUrl: string): FormTestUrlsResult {
  const urls: string[] = []
  const rejected: { input: string; reason: string }[] = []

  let siteHost: string
  try {
    siteHost = new URL(siteUrl).hostname.toLowerCase()
  } catch {
    return { urls: [], rejected: inputs.map((input) => ({ input, reason: 'site inválido' })) }
  }

  for (const raw of inputs) {
    const input = raw.trim()
    if (!input) continue

    // Aceita "/contactos" tanto como o URL completo: quem está a olhar para o
    // painel do site pensa em páginas, não em endereços absolutos.
    const normalized = normalizeUrl(input, siteUrl)
    if (!normalized) {
      rejected.push({ input, reason: 'não é um endereço http(s) válido' })
      continue
    }

    if (new URL(normalized).hostname.toLowerCase() !== siteHost) {
      rejected.push({ input, reason: `não pertence a ${siteHost}` })
      continue
    }

    // A mesma chave das comparações: senão `/a` e `/a/` gastavam duas das três
    // vagas a apontar para a mesma página.
    const chave = pageKey(normalized, siteUrl)
    if (urls.some((existing) => pageKey(existing, siteUrl) === chave)) continue

    if (urls.length >= MAX_FORM_TEST_URLS) {
      rejected.push({ input, reason: `máximo de ${MAX_FORM_TEST_URLS} páginas` })
      continue
    }

    urls.push(normalized)
  }

  return { urls, rejected }
}

/**
 * Chave de comparação de páginas.
 *
 * O `normalizeUrl` não tira a barra final, e faz bem: para o verificador de
 * links `/a` e `/a/` podem ser recursos diferentes, e o URL normalizado é o
 * fingerprint dos findings. Aqui a pergunta é outra — "é esta a página que o
 * administrador declarou?" — e para essa, `/contactos` e `/contactos/` são a
 * mesma coisa. Um teste que não corresse por causa de uma barra seria
 * indistinguível de um teste desligado, e ninguém ia perceber porquê.
 */
function pageKey(input: string, siteUrl: string): string | null {
  const normalized = normalizeUrl(input, siteUrl)
  if (!normalized) return null

  const url = new URL(normalized)
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }
  return url.toString()
}

/** A página onde este formulário vive está declarada? */
export function isDeclaredPage(
  pageUrl: string,
  declared: readonly string[],
  siteUrl: string,
): boolean {
  const page = pageKey(pageUrl, siteUrl)
  if (!page) return false
  return declared.some((candidate) => pageKey(candidate, siteUrl) === page)
}
