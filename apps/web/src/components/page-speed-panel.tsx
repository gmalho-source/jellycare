import { LIMIARES } from '@jellycare/checks'
import { COR_ESTADO } from '@/lib/chart-colors'
import { formatNumero } from './ui'
import type { PageSpeedHistory, PageSpeedPoint } from '@/lib/queries'

/**
 * A velocidade das páginas, medida pela PageSpeed Insights.
 *
 * Um componente de servidor: não há nada aqui que precise de reagir ao rato,
 * e o que interessa nesta secção é o número atual e a forma da série. Fazê-lo
 * interativo custava JavaScript no cliente para não acrescentar nada.
 *
 * Os limiares são os da Google, importados do check — não copiados. O painel
 * a dizer «bom» sobre o que o check marcou como problema seria a plataforma a
 * contradizer-se a si própria dentro do mesmo ecrã.
 */

function estadoScore(score: number): keyof typeof COR_ESTADO {
  if (score >= LIMIARES.scoreRazoavel) return 'bom'
  if (score >= LIMIARES.scoreMau) return 'medio'
  return 'mau'
}

function estadoMetrica(
  valor: number | null,
  razoavel: number,
  mau: number,
): keyof typeof COR_ESTADO {
  if (valor === null) return 'sem'
  if (valor <= razoavel) return 'bom'
  if (valor <= mau) return 'medio'
  return 'mau'
}

const PALAVRA: Record<keyof typeof COR_ESTADO, string> = {
  bom: 'bom',
  medio: 'a melhorar',
  mau: 'mau',
  sem: 'sem dados',
}

/** Um mostrador em arco. Meia-volta chega: o valor é sempre de 0 a 100. */
function Mostrador({ score }: { score: number }) {
  const estado = estadoScore(score)
  const raio = 52
  const perimetro = Math.PI * raio
  const arco = `M 10 62 A ${raio} ${raio} 0 0 1 114 62`

  return (
    <div className="relative w-[124px] shrink-0">
      <svg viewBox="0 0 124 72" className="w-full" role="img" aria-label={`${score} em 100`}>
        <path d={arco} fill="none" stroke="#eeeef1" strokeWidth={10} strokeLinecap="round" />
        <path
          d={arco}
          fill="none"
          stroke={COR_ESTADO[estado]}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${((score / 100) * perimetro).toFixed(1)} ${perimetro.toFixed(1)}`}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <span
          className="text-3xl font-semibold tracking-tight"
          style={{ color: COR_ESTADO[estado] }}
        >
          {score}
        </span>
        <span className="text-sm text-ink-400">/100</span>
      </div>
    </div>
  )
}

function Vital({
  nome,
  descricao,
  valor,
  estado,
}: {
  nome: string
  descricao: string
  valor: string
  estado: keyof typeof COR_ESTADO
}) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-t border-ink-100 py-2 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{nome}</p>
        <p className="text-xs text-ink-400">{descricao}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm tabular-nums" style={{ color: COR_ESTADO[estado] }}>
          {valor}
        </span>
        {/* A cor não anda sozinha: uma palavra ao lado, para quem não a
            distingue e para quem imprime isto a preto e branco. */}
        <span className="w-20 text-right text-xs text-ink-400">{PALAVRA[estado]}</span>
      </div>
    </li>
  )
}

/** A série da pontuação, pequena, só para se ver se está a subir ou a descer. */
function Serie({ points }: { points: PageSpeedPoint[] }) {
  // Menos de três medições não dão uma forma. Duas são uma reta por
  // definição, e uma reta não diz nada que o «+12 pontos» ao lado não diga
  // melhor — no ecrã lia-se como um traço separador e não como dados.
  if (points.length < 3) return null

  const largura = 320
  // Alta o suficiente para a escala fixa de 0 a 100 deixar ver a variação
  // real: a 44px, vinte pontos de diferença desenhavam oito pixéis e a série
  // lia-se como uma reta.
  const altura = 64
  const x = (indice: number) => (indice / (points.length - 1)) * largura
  // Escala fixa de 0 a 100, porque é essa a escala da pontuação. Ajustá-la ao
  // intervalo observado fazia uma oscilação de dois pontos parecer um
  // desabamento.
  const y = (score: number) => altura - (score / 100) * altura

  const traco = points
    .map((ponto, indice) => `${indice === 0 ? 'M' : 'L'}${x(indice).toFixed(1)},${y(ponto.score).toFixed(1)}`)
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${largura} ${altura}`}
      preserveAspectRatio="none"
      className="mt-4 h-16 w-full"
      role="img"
      aria-label={`Pontuação ao longo de ${points.length} medições`}
    >
      <path
        d={traco}
        fill="none"
        stroke="#17171c"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Um ponto por medição: sem eles a linha parecia contínua e escondia
          que cada vértice é uma passagem diária, não uma interpolação. */}
      {points.map((ponto, indice) => (
        <circle
          key={ponto.measuredAt.toISOString()}
          cx={x(indice)}
          cy={y(ponto.score)}
          r={2.5}
          fill="#17171c"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

function dataCurta(quando: Date): string {
  return quando.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
}

export function PageSpeedPanel({ history }: { history: PageSpeedHistory }) {
  const { latest, points, trend } = history

  if (!latest) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-400">
        A primeira medição de velocidade aparece aqui depois da próxima passagem diária.
      </p>
    )
  }

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Mostrador score={latest.score} />

        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-600">
            Medido em telemóvel, que é como a Google indexa. A velocidade conta para a posição
            na pesquisa e para quem desiste antes de a página abrir.
          </p>
          <p className="mt-1 text-xs text-ink-400">
            Última medição a {dataCurta(latest.measuredAt)}
            {trend !== null && trend !== 0 && (
              <>
                {' '}
                · {trend > 0 ? '+' : ''}
                {trend} pontos face a {points[0] ? dataCurta(points[0].measuredAt) : 'há 30 dias'}
              </>
            )}
          </p>
        </div>
      </div>

      {/* A série fica à largura toda e não ao lado do mostrador: espremida na
          coluna do texto, no telemóvel, lia-se como um risco solto em vez de
          uma linha que sobe ou desce. */}
      <Serie points={points} />

      <ul className="mt-4">
        <Vital
          nome="Maior elemento visível"
          descricao="Quanto tempo até a página parecer carregada (LCP)"
          valor={latest.lcpMs === null ? '—' : `${formatNumero(latest.lcpMs / 1000, 1)} s`}
          estado={estadoMetrica(latest.lcpMs, LIMIARES.lcpRazoavel, LIMIARES.lcpMau)}
        />
        <Vital
          nome="Estabilidade visual"
          descricao="Quanto o conteúdo salta enquanto carrega (CLS)"
          valor={latest.cls === null ? '—' : formatNumero(latest.cls, 2)}
          estado={estadoMetrica(latest.cls, LIMIARES.clsRazoavel, LIMIARES.clsMau)}
        />
        <Vital
          nome="Resposta a cliques"
          descricao="Tempo em que a página ignora quem clica (TBT)"
          valor={latest.tbtMs === null ? '—' : `${Math.round(latest.tbtMs)} ms`}
          estado={estadoMetrica(latest.tbtMs, LIMIARES.tbtRazoavel, LIMIARES.tbtMau)}
        />
      </ul>
    </div>
  )
}
