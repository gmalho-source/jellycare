'use client'

import { useState } from 'react'

/**
 * Trinta dias de disponibilidade, um dia por barra.
 *
 * Tira a forma de uma faixa de estado e não de uma linha de percentagens: em
 * quase todos os dias o valor é 100%, e uma linha quase plana esconde
 * exactamente o que interessa encontrar de relance — o dia mau.
 *
 * As barras têm altura igual porque codificam estado e não magnitude. A
 * magnitude está no tooltip, junto com o número de observações em que
 * assenta.
 *
 * A cor sozinha nunca chega: há legenda sempre visível, tooltip por barra, e
 * a lista de incidentes por baixo diz em texto o que a faixa diz em cor.
 */

export interface DailyUptime {
  day: string
  up: number
  total: number
  percent: number | null
}

/**
 * As cores passaram o validador de paletas para visão normal e daltonismo
 * (ΔE 9.9 no pior par em protanopia, 22.8 em visão normal). O vermelho é o
 * mesmo `jelly-700` que as badges de severidade já usam para crítico — o
 * estado tem de se ler igual em todo o produto.
 */
const ESTADOS = {
  bom: { fill: '#15803d', label: 'Sem falhas' },
  degradado: { fill: '#ca8a04', label: 'Falhas pontuais' },
  mau: { fill: '#a32233', label: 'Indisponível' },
  vazio: { fill: '#dcdce2', label: 'Sem observações' },
} as const

type Estado = keyof typeof ESTADOS

/**
 * Um dia sem observações é cinzento e não verde.
 *
 * Não ter olhado não é o mesmo que estar bem, e é a diferença que evita
 * prometer a um cliente uma disponibilidade que nunca medimos.
 */
function estadoDe(day: DailyUptime): Estado {
  if (day.total === 0 || day.percent === null) return 'vazio'
  if (day.percent >= 100) return 'bom'
  if (day.percent >= 99) return 'degradado'
  return 'mau'
}

function dataCurta(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

export function UptimeStrip({ days }: { days: DailyUptime[] }) {
  const [activo, setActivo] = useState<DailyUptime | null>(null)

  const presentes = new Set(days.map(estadoDe))

  return (
    <div className="px-5 py-4">
      <div className="flex h-10 items-stretch gap-[2px]">
        {days.map((day) => {
          const estado = estadoDe(day)
          const legenda =
            day.percent === null
              ? `${dataCurta(day.day)} — sem observações`
              : `${dataCurta(day.day)} — ${day.percent.toFixed(2)}% em ${day.total} ${
                  day.total === 1 ? 'observação' : 'observações'
                }`

          return (
            <button
              key={day.day}
              type="button"
              aria-label={legenda}
              title={legenda}
              onMouseEnter={() => setActivo(day)}
              onMouseLeave={() => setActivo(null)}
              onFocus={() => setActivo(day)}
              onBlur={() => setActivo(null)}
              className="flex-1 rounded-[3px] outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-jelly-500"
              style={{ backgroundColor: ESTADOS[estado].fill }}
            />
          )
        })}
      </div>

      <div className="mt-2 flex h-4 items-center justify-between text-xs text-ink-400">
        <span>{days[0] ? dataCurta(days[0].day) : ''}</span>
        {activo ? (
          <span className="text-ink-900">
            {activo.percent === null
              ? `${dataCurta(activo.day)} — sem observações`
              : `${dataCurta(activo.day)} — ${activo.percent.toFixed(2)}% em ${activo.total} ${
                  activo.total === 1 ? 'observação' : 'observações'
                }`}
          </span>
        ) : null}
        <span>{days.at(-1) ? dataCurta(days.at(-1)!.day) : 'hoje'}</span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-500">
        {(Object.keys(ESTADOS) as Estado[])
          .filter((estado) => presentes.has(estado))
          .map((estado) => (
            <li key={estado} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-[2px]"
                style={{ backgroundColor: ESTADOS[estado].fill }}
              />
              {ESTADOS[estado].label}
            </li>
          ))}
      </ul>
    </div>
  )
}
