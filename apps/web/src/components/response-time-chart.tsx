'use client'

import { useState } from 'react'

/**
 * Tempo de resposta, dia a dia.
 *
 * Uma série só, por isso sem legenda de cores: o título diz o que é. A linha
 * é fina e a grelha recuada, para o que se lê ser a forma da série e não a
 * moldura.
 *
 * **Um dia sem observações é uma interrupção na linha, não um zero.** Zero
 * milissegundos é uma afirmação absurda, e ligá-la aos vizinhos desenhava uma
 * descida a pique que nunca aconteceu. É a mesma regra da faixa de
 * disponibilidade: não ter olhado não é o mesmo que ter estado bem.
 *
 * Os limiares são os da prática corrente em monitorização: abaixo de 800ms é
 * rápido, acima de 1,8s é lento. Servem para colorir o valor e a linha média,
 * não para colorir a série — pintar cada segmento de uma cor tornava a forma
 * ilegível, que é a única coisa que este gráfico tem para dar.
 */

export interface DiaResposta {
  day: string
  average: number | null
  slowest: number | null
  samples: number
}

const RAPIDO = 800
const LENTO = 1800

/** As mesmas cores de estado do resto do produto. */
const COR = { bom: '#15803d', medio: '#a16207', mau: '#a32233' }

function corDe(ms: number | null): string {
  if (ms === null) return '#8b8b96'
  if (ms < RAPIDO) return COR.bom
  if (ms <= LENTO) return COR.medio
  return COR.mau
}

function dataCurta(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

export function ResponseTimeChart({ days }: { days: DiaResposta[] }) {
  const [activo, setActivo] = useState<DiaResposta | null>(null)

  const comDados = days.filter((dia) => dia.average !== null)
  if (comDados.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-400">
        Ainda não há observações suficientes para desenhar o tempo de resposta.
      </p>
    )
  }

  const media = Math.round(
    comDados.reduce((total, dia) => total + (dia.average ?? 0), 0) / comDados.length,
  )
  const maisRapido = Math.min(...comDados.map((dia) => dia.average as number))
  const maisLento = Math.max(...comDados.map((dia) => dia.average as number))

  // Escala com folga no topo, e sempre a começar no zero: uma escala que
  // começa noutro sítio faz variações de dez milissegundos parecerem um
  // precipício.
  const teto = Math.max(maisLento * 1.15, 200)
  const largura = 720
  const altura = 160
  const x = (indice: number) => (indice / Math.max(days.length - 1, 1)) * largura
  const y = (valor: number) => altura - (valor / teto) * altura

  // Segmentos separados por cada interrupção, para os dias sem observações
  // ficarem mesmo em branco.
  const segmentos: string[] = []
  let atual: string[] = []
  days.forEach((dia, indice) => {
    if (dia.average === null) {
      if (atual.length > 1) segmentos.push(atual.join(' '))
      atual = []
      return
    }
    atual.push(`${atual.length === 0 ? 'M' : 'L'}${x(indice).toFixed(1)},${y(dia.average).toFixed(1)}`)
  })
  if (atual.length > 1) segmentos.push(atual.join(' '))

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-2xl font-semibold tracking-tight" style={{ color: corDe(media) }}>
          {media} ms
        </p>
        <p className="text-xs text-ink-400">
          média de {comDados.length} {comDados.length === 1 ? 'dia' : 'dias'} · mais rápido{' '}
          {maisRapido} ms · mais lento {maisLento} ms
        </p>
      </div>

      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        preserveAspectRatio="none"
        className="mt-3 h-40 w-full"
        role="img"
        aria-label={`Tempo de resposta médio de ${media} milissegundos ao longo de ${days.length} dias`}
      >
        {[0.25, 0.5, 0.75].map((fracao) => (
          <line
            key={fracao}
            x1={0}
            x2={largura}
            y1={altura * fracao}
            y2={altura * fracao}
            stroke="#eeeef1"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <line
          x1={0}
          x2={largura}
          y1={y(media)}
          y2={y(media)}
          stroke="#8b8b96"
          strokeWidth={1}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />

        {segmentos.map((segmento) => (
          <path
            key={segmento.slice(0, 24)}
            d={segmento}
            fill="none"
            stroke="#17171c"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {activo?.average != null && (
          <circle
            cx={x(days.indexOf(activo))}
            cy={y(activo.average)}
            r={4}
            fill={corDe(activo.average)}
            stroke="#ffffff"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Alvos de leitura sobre o gráfico: uma coluna por dia, largas o
          suficiente para o dedo. Um `<svg>` não dá foco por teclado aos
          pontos, e estes botões dão. */}
      <div className="-mt-40 flex h-40" aria-hidden>
        {days.map((dia) => (
          <button
            key={dia.day}
            type="button"
            tabIndex={-1}
            onMouseEnter={() => setActivo(dia)}
            onMouseLeave={() => setActivo(null)}
            onFocus={() => setActivo(dia)}
            className="flex-1 cursor-default"
          />
        ))}
      </div>

      <div className="mt-2 flex h-4 items-center justify-between text-xs text-ink-400">
        <span>{days[0] ? dataCurta(days[0].day) : ''}</span>
        {activo && (
          <span className="text-ink-900">
            {dataCurta(activo.day)} —{' '}
            {activo.average === null
              ? 'sem observações'
              : `${activo.average} ms em média, pior ${activo.slowest} ms, ${activo.samples} ${
                  activo.samples === 1 ? 'observação' : 'observações'
                }`}
          </span>
        )}
        <span>{days.at(-1) ? dataCurta(days.at(-1)!.day) : 'hoje'}</span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-500">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: COR.bom }} />
          Rápido, abaixo de {RAPIDO} ms
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: COR.medio }} />
          Aceitável, até {LENTO / 1000} s
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: COR.mau }} />
          Lento, acima de {LENTO / 1000} s
        </li>
      </ul>
    </div>
  )
}
