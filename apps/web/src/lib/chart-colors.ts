/**
 * As cores de estado dos gráficos.
 *
 * As mesmas três do resto do produto, num sítio só: dois gráficos a dizerem
 * «bom» em verdes ligeiramente diferentes é a forma silenciosa de a paleta se
 * desfazer. Ficam em hexadecimal porque entram em atributos de SVG, onde as
 * classes do Tailwind não chegam.
 */
export const COR_ESTADO = {
  bom: '#1f9370',
  medio: '#b87d00',
  mau: '#c0243a',
  /** Sem dados. Nunca é um juízo — é a ausência de um. */
  sem: '#a3a3ad',
} as const

export type EstadoGrafico = keyof typeof COR_ESTADO

/**
 * A cor de uma série que não é um juízo: a linha do tempo de resposta, por
 * exemplo. Fora das cores de estado de propósito, para ninguém ler a linha
 * como «bom» ou «mau» só pela cor. Contraste de 6,3:1 sobre branco.
 */
export const COR_SERIE = '#4f46e5'
