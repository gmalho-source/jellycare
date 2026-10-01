/**
 * As contas do gráfico do tempo de resposta, à parte do desenho.
 *
 * Ficam aqui para se poderem testar sem browser: a média, a escala, a curva e
 * o ponteiro do mostrador são as partes onde um erro passa despercebido a olho
 * e mente ao cliente.
 */

export interface DiaResposta {
  day: string
  average: number | null
  slowest: number | null
  samples: number
}

/** Os limiares habituais em monitorização: abaixo de 800 ms é rápido, acima de 1,8 s é lento. */
export const RAPIDO = 800
export const LENTO = 1800

export type Classe = 'bom' | 'medio' | 'mau'

export function classeDe(ms: number): Classe {
  if (ms < RAPIDO) return 'bom'
  if (ms <= LENTO) return 'medio'
  return 'mau'
}

export interface Resumo {
  /** Média dos dias com observações. Um dia sem nenhuma não entra, nem como zero. */
  media: number
  maisRapido: { indice: number; ms: number }
  maisLento: { indice: number; ms: number }
  diasComDados: number
}

export function resumir(dias: readonly DiaResposta[]): Resumo | null {
  const comDados = dias
    .map((dia, indice) => ({ indice, ms: dia.average }))
    .filter((dia): dia is { indice: number; ms: number } => dia.ms !== null)
  if (comDados.length === 0) return null

  let maisRapido = comDados[0]!
  let maisLento = comDados[0]!
  for (const dia of comDados) {
    if (dia.ms < maisRapido.ms) maisRapido = dia
    if (dia.ms > maisLento.ms) maisLento = dia
  }
  return {
    media: Math.round(comDados.reduce((total, dia) => total + dia.ms, 0) / comDados.length),
    maisRapido,
    maisLento,
    diasComDados: comDados.length,
  }
}

/**
 * Escala do eixo, sempre a começar no zero e em números redondos.
 *
 * Uma escala que começa noutro sítio faz dez milissegundos parecerem um
 * precipício. Quatro intervalos, com o passo redondo mais pequeno que deixa
 * folga acima do dia mais lento.
 */
export function escala(maximo: number): { teto: number; marcas: number[] } {
  const passos = [50, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1500, 2000, 2500, 5000, 10000]
  const alvo = Math.max(maximo * 1.1, 200)
  const passo = passos.find((p) => p * 4 >= alvo) ?? Math.ceil(alvo / 4 / 1000) * 1000
  return { teto: passo * 4, marcas: [0, 1, 2, 3, 4].map((i) => i * passo) }
}

/**
 * Curva suave pelos pontos, sem inventar picos.
 *
 * Interpolação monótona (Fritsch–Carlson): entre dois dias, a curva nunca
 * passa acima do mais lento nem abaixo do mais rápido. Uma curva de Bézier
 * comum arredonda os picos para lá do valor medido, e o cliente lia um dia
 * pior do que foi.
 */
export function curva(pontos: readonly { x: number; y: number }[]): string {
  const n = pontos.length
  if (n === 0) return ''
  const p = (i: number) => pontos[i]!
  if (n === 1) return `M${p(0).x},${p(0).y}`

  const inclinacoes: number[] = []
  for (let i = 0; i < n - 1; i++) inclinacoes.push((p(i + 1).y - p(i).y) / (p(i + 1).x - p(i).x))

  const tangentes = pontos.map((_, i) => {
    if (i === 0) return inclinacoes[0]!
    if (i === n - 1) return inclinacoes[n - 2]!
    const antes = inclinacoes[i - 1]!
    const depois = inclinacoes[i]!
    return antes * depois <= 0 ? 0 : (antes + depois) / 2
  })

  for (let i = 0; i < n - 1; i++) {
    const m = inclinacoes[i]!
    if (m === 0) {
      tangentes[i] = 0
      tangentes[i + 1] = 0
      continue
    }
    const a = tangentes[i]! / m
    const b = tangentes[i + 1]! / m
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      tangentes[i] = tau * a * m
      tangentes[i + 1] = tau * b * m
    }
  }

  const r = (v: number) => Number(v.toFixed(2))
  let d = `M${r(p(0).x)},${r(p(0).y)}`
  for (let i = 0; i < n - 1; i++) {
    const dx = (p(i + 1).x - p(i).x) / 3
    d += ` C${r(p(i).x + dx)},${r(p(i).y + tangentes[i]! * dx)} ${r(p(i + 1).x - dx)},${r(p(i + 1).y - tangentes[i + 1]! * dx)} ${r(p(i + 1).x)},${r(p(i + 1).y)}`
  }
  return d
}

/**
 * Onde o ponteiro do mostrador aponta, de 0 (à esquerda) a 1 (à direita).
 *
 * Escala linear e honesta até 2,7 s, ou um pouco acima do valor se for mais
 * lento ainda: o verde ocupa o terço que lhe cabe, e não um terço desenhado à
 * medida para parecer maior.
 */
export const MOSTRADOR_MAXIMO = 2700

export function fracaoDoMostrador(ms: number): number {
  return Math.min(Math.max(ms / MOSTRADOR_MAXIMO, 0), 1)
}

/** Os dias divididos nos troços com observações, para os dias vazios ficarem em branco. */
export function trocos(dias: readonly DiaResposta[]): { indice: number; ms: number }[][] {
  const resultado: { indice: number; ms: number }[][] = []
  let atual: { indice: number; ms: number }[] = []
  dias.forEach((dia, indice) => {
    if (dia.average === null) {
      if (atual.length > 0) resultado.push(atual)
      atual = []
      return
    }
    atual.push({ indice, ms: dia.average })
  })
  if (atual.length > 0) resultado.push(atual)
  return resultado
}
