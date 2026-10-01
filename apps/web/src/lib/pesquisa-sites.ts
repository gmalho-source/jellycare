/**
 * A pesquisa da lista de sites.
 *
 * Sem acentos e sem maiúsculas, e com cada palavra a ter de aparecer em
 * algum sítio: «clinica lisboa» encontra «Clínica Sorriso — Lisboa», e
 * «acpa.pt» encontra pelo domínio. Corre no browser sobre a lista que já
 * está carregada: com centenas de sites continua instantâneo, e não há um
 * pedido por tecla.
 */

export interface Pesquisavel {
  label: string
  hostname: string
  url: string
}

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export function filtrarSites<T extends Pesquisavel>(sites: readonly T[], termo: string): T[] {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return [...sites]
  return sites.filter((site) => {
    const alvo = normalizar(`${site.label} ${site.hostname} ${site.url}`)
    return palavras.every((palavra) => alvo.includes(palavra))
  })
}

export type VistaSites = 'lista' | 'grelha'

export const COOKIE_VISTA_SITES = 'jellycare_vista_sites'

export function vistaSitesDe(valor: string | undefined): VistaSites {
  return valor === 'grelha' ? 'grelha' : 'lista'
}
