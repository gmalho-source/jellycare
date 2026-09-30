import { PONTUACAO_BOA, PONTUACAO_MA, type Semaforo } from '@jellycare/core'
import type { ReportDay } from './detalhe.js'

/**
 * Os gráficos do relatório, em SVG escrito à mão.
 *
 * Sem biblioteca: o PDF é gerado por um browser sem rede, e um gráfico que
 * dependesse de carregar um script saía em branco no dia em que a CDN
 * falhasse. Tudo aqui é marcação estática, e o texto vai sempre em tinta
 * normal — a cor identifica, não informa sozinha.
 */

export const COR = {
  bom: '#1f9370',
  medio: '#b87d00',
  mau: '#c0243a',
  sem: '#a3a3ad',
  saudavel: '#2fa37f',
  vazio: '#e4e4ea',
  fundo: '#f0ede8',
  tinta: '#17171c',
  eixo: '#8b8b96',
  grelha: '#eeeef1',
} as const

export const COR_SEMAFORO: Record<Semaforo, string> = {
  verde: COR.bom,
  laranja: COR.medio,
  vermelho: COR.mau,
  cinzento: COR.sem,
}

export function corDaPontuacao(score: number | null): string {
  if (score === null) return COR.sem
  if (score >= PONTUACAO_BOA) return COR.bom
  if (score >= PONTUACAO_MA) return COR.medio
  return COR.mau
}

const TEXTO = `font-family="ui-sans-serif, system-ui, sans-serif" font-size="8" fill="${COR.eixo}"`

/** Um mostrador circular de 0 a 100, como os da PageSpeed. */
export function mostrador(score: number | null, rotulo: string): string {
  const cor = corDaPontuacao(score)
  const raio = 30
  const perimetro = 2 * Math.PI * raio
  const arco =
    score === null
      ? ''
      : `<circle cx="38" cy="38" r="${raio}" fill="none" stroke="${cor}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${((score / 100) * perimetro).toFixed(1)} ${perimetro.toFixed(1)}" transform="rotate(-90 38 38)"/>`
  return `<svg width="72" height="72" viewBox="0 0 76 76" role="img" aria-label="${rotulo}: ${score === null ? 'sem medição' : `${score} em 100`}">
    <circle cx="38" cy="38" r="${raio}" fill="none" stroke="${COR.fundo}" stroke-width="6"/>
    ${arco}
    <text x="38" y="44" text-anchor="middle" font-size="18" font-weight="650" fill="${cor}" font-family="ui-sans-serif, system-ui, sans-serif">${score ?? '—'}</text>
  </svg>`
}

/** A navegação com agência: uma fração, não uma pontuação. */
export function fracao(agentic: { passed: number; total: number } | null): string {
  const cor =
    agentic === null
      ? COR.sem
      : agentic.passed === agentic.total
        ? COR.bom
        : agentic.passed === 0
          ? COR.mau
          : COR.medio
  const texto = agentic === null ? '—' : `${agentic.passed}/${agentic.total}`
  return `<svg width="72" height="72" viewBox="0 0 76 76" role="img" aria-label="Navegação com agência: ${agentic === null ? 'sem medição' : `${agentic.passed} de ${agentic.total}`}">
    <rect x="10" y="26" width="56" height="24" rx="12" fill="${cor}1a"/>
    <circle cx="22" cy="38" r="3.5" fill="${cor}"/>
    <text x="44" y="42.5" text-anchor="middle" font-size="12" font-weight="650" fill="${cor}" font-family="ui-sans-serif, system-ui, sans-serif">${texto}</text>
  </svg>`
}

/**
 * A disponibilidade dia a dia, uma barra por dia.
 *
 * Os dias antes da entrada no acompanhamento juntam-se num bloco cinzento com
 * a legenda, em vez de uma fila de barras vazias que se leria como falhas.
 */
export function tiraDiaria(dias: readonly ReportDay[], objetivo: number): string {
  if (dias.length === 0) return ''
  const largura = 540
  const altura = 26
  const antes = dias.filter((dia) => dia.antes).length
  const acompanhados = dias.filter((dia) => !dia.antes)
  const espaco = 3
  // O bloco dos dias anteriores ocupa a proporção que teria, para a tira
  // continuar a ser uma linha do tempo e não só uma fila de barras.
  const larguraBloco = antes > 0 ? (antes / dias.length) * largura - espaco : 0
  const inicio = antes > 0 ? larguraBloco + espaco : 0
  const passo = (largura - inicio) / Math.max(1, acompanhados.length)

  const cor = (dia: ReportDay) =>
    dia.disponivel === null
      ? COR.vazio
      : dia.disponivel >= objetivo
        ? COR.saudavel
        : dia.disponivel >= 95
          ? COR.medio
          : COR.mau

  const barras = acompanhados
    .map(
      (dia, indice) =>
        `<rect x="${(inicio + indice * passo).toFixed(1)}" y="6" width="${Math.max(1, passo - espaco).toFixed(1)}" height="${altura}" rx="2.5" fill="${cor(dia)}"><title>${dia.dia}: ${
          dia.disponivel === null ? 'sem observações' : `${dia.disponivel.toFixed(2).replace('.', ',')}%`
        }</title></rect>`,
    )
    .join('')

  const bloco =
    antes > 0
      ? `<rect x="0" y="6" width="${larguraBloco.toFixed(1)}" height="${altura}" rx="4" fill="#f3f3f5"/>
         ${larguraBloco > 110 ? `<text x="${(larguraBloco / 2).toFixed(1)}" y="23" text-anchor="middle" ${TEXTO}>antes do acompanhamento</text>` : ''}`
      : ''

  const primeiro = acompanhados[0]
  const ultimo = acompanhados.at(-1)
  const rotulos = [
    `<text x="0" y="46" ${TEXTO}>${dias[0]!.rotulo}</text>`,
    primeiro && antes > 0
      ? `<text x="${(inicio + passo / 2).toFixed(1)}" y="46" text-anchor="middle" ${TEXTO}>${primeiro.rotulo}</text>`
      : '',
    ultimo && ultimo !== primeiro
      ? `<text x="${largura}" y="46" text-anchor="end" ${TEXTO}>${ultimo.rotulo}</text>`
      : '',
  ].join('')

  return `<svg width="100%" viewBox="0 0 ${largura} 50" role="img" aria-label="Disponibilidade dia a dia">${bloco}${barras}${rotulos}</svg>`
}

/** Um teto redondo para o eixo, para os valores não tocarem no topo. */
function teto(maximo: number, minimo: number): number {
  const alvo = Math.max(maximo * 1.2, minimo)
  const ordem = 10 ** Math.floor(Math.log10(alvo))
  return Math.ceil(alvo / ordem) * ordem
}

/**
 * Uma linha com pontos, com a escala do eixo dada ou calculada.
 *
 * Menos de dois pontos não é uma linha e não se desenha: um traço solto lia-se
 * como dados.
 */
export function linha(
  pontos: readonly { rotulo: string; valor: number }[],
  opcoes: { maximo?: number; minimoDoTeto?: number; unidade?: string; largura?: number },
): string {
  if (pontos.length < 2) return ''
  const largura = opcoes.largura ?? 540
  const altura = 64
  const esquerda = 30
  const maximo = opcoes.maximo ?? teto(Math.max(...pontos.map((p) => p.valor)), opcoes.minimoDoTeto ?? 1)
  const x = (indice: number) => esquerda + 8 + (indice / (pontos.length - 1)) * (largura - esquerda - 12)
  const y = (valor: number) => 8 + altura - (Math.min(valor, maximo) / maximo) * altura

  const traco = pontos.map((p, i) => `${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ')
  const meio = maximo / 2
  const formatar = (valor: number) => (Number.isInteger(valor) ? String(valor) : valor.toFixed(1))

  return `<svg width="100%" viewBox="0 0 ${largura} 92" role="img" aria-label="Evolução ao longo do período">
    <line x1="${esquerda}" y1="8" x2="${largura}" y2="8" stroke="${COR.grelha}"/>
    <line x1="${esquerda}" y1="${y(meio).toFixed(1)}" x2="${largura}" y2="${y(meio).toFixed(1)}" stroke="${COR.grelha}"/>
    <line x1="${esquerda}" y1="${8 + altura}" x2="${largura}" y2="${8 + altura}" stroke="#dcdce2"/>
    <text x="0" y="11" ${TEXTO}>${formatar(maximo)}${opcoes.unidade ?? ''}</text>
    <text x="0" y="${(y(meio) + 3).toFixed(1)}" ${TEXTO}>${formatar(meio)}</text>
    <text x="0" y="${8 + altura + 3}" ${TEXTO}>0</text>
    <polyline fill="none" stroke="${COR.tinta}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${traco}"/>
    ${pontos.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.valor).toFixed(1)}" r="2.5" fill="${COR.tinta}"/>`).join('')}
    <text x="${x(0).toFixed(1)}" y="88" text-anchor="middle" ${TEXTO}>${pontos[0]!.rotulo}</text>
    <text x="${x(pontos.length - 1).toFixed(1)}" y="88" text-anchor="end" ${TEXTO}>${pontos.at(-1)!.rotulo}</text>
  </svg>`
}
