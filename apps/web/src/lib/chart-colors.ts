/**
 * As cores de estado dos gráficos.
 *
 * As mesmas três do resto do produto, num sítio só: dois gráficos a dizerem
 * «bom» em verdes ligeiramente diferentes é a forma silenciosa de a paleta se
 * desfazer. Ficam em hexadecimal porque entram em atributos de SVG, onde as
 * classes do Tailwind não chegam.
 */
export const COR_ESTADO = {
  bom: '#15803d',
  medio: '#a16207',
  mau: '#a32233',
  /** Sem dados. Nunca é um juízo — é a ausência de um. */
  sem: '#8b8b96',
} as const

export type EstadoGrafico = keyof typeof COR_ESTADO
