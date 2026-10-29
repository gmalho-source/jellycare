import {
  FAMILIAS_DE_ATIVIDADE,
  tiposDaFamilia,
  type FamiliaDeAtividade,
  type TipoDeAtividade,
} from '@jellycare/core'

/** Os períodos que a vista oferece. O primeiro é o de omissão. */
export const PERIODOS = [
  { valor: '30d', rotulo: '30 dias', dias: 30 },
  { valor: '7d', rotulo: '7 dias', dias: 7 },
  { valor: '90d', rotulo: '90 dias', dias: 90 },
  { valor: '12m', rotulo: '12 meses', dias: 365 },
] as const

export type Periodo = (typeof PERIODOS)[number]['valor']

export interface FiltroDaVista {
  periodo: Periodo
  familia: FamiliaDeAtividade | null
  siteId: string | null
  desde: Date
  tipos: TipoDeAtividade[] | undefined
}

/** Um parâmetro da URL pode vir repetido; conta o primeiro. */
function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor
}

/**
 * Lê o filtro da URL. O que não se reconhece cai no valor de omissão, em vez
 * de dar erro: um link antigo ou mal copiado deve abrir a página, não partir.
 */
export function lerFiltro(
  parametros: Record<string, string | string[] | undefined>,
  agora: Date = new Date(),
): FiltroDaVista {
  const periodoPedido = primeiro(parametros.periodo)
  const periodo = PERIODOS.find((p) => p.valor === periodoPedido) ?? PERIODOS[0]

  const familiaPedida = primeiro(parametros.tipo)
  const familia =
    familiaPedida && familiaPedida in FAMILIAS_DE_ATIVIDADE ? (familiaPedida as FamiliaDeAtividade) : null

  const sitePedido = primeiro(parametros.site)
  const siteId = sitePedido && /^[0-9a-f-]{36}$/i.test(sitePedido) ? sitePedido : null

  return {
    periodo: periodo.valor,
    familia,
    siteId,
    desde: new Date(agora.getTime() - periodo.dias * 24 * 3600_000),
    tipos: familia ? tiposDaFamilia(familia) : undefined,
  }
}

/** O endereço da mesma vista com um filtro trocado. */
export function hrefComFiltro(
  base: string,
  filtro: Pick<FiltroDaVista, 'periodo' | 'familia' | 'siteId'>,
  troca: Partial<Pick<FiltroDaVista, 'periodo' | 'familia' | 'siteId'>>,
): string {
  const final = { ...filtro, ...troca }
  const parametros = new URLSearchParams()
  if (final.periodo !== PERIODOS[0].valor) parametros.set('periodo', final.periodo)
  if (final.familia) parametros.set('tipo', final.familia)
  if (final.siteId) parametros.set('site', final.siteId)
  const texto = parametros.toString()
  return texto ? `${base}?${texto}` : base
}
