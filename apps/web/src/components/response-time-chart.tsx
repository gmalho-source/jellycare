'use client'

import { useState } from 'react'
import { COR_ESTADO, COR_SERIE } from '@/lib/chart-colors'
import {
  LENTO,
  RAPIDO,
  classeDe,
  curva,
  escala,
  fracaoDoMostrador,
  resumir,
  trocos,
  type DiaResposta,
} from '@/lib/tempo-resposta'
import { formatNumero } from './ui'

export type { DiaResposta } from '@/lib/tempo-resposta'

/**
 * Tempo de resposta: um mostrador com a média do período e a linha dia a dia.
 *
 * O mostrador responde a «isto é rápido?», e por isso leva as cores de estado
 * com a palavra ao lado. A linha responde a «como tem andado?», e por isso tem
 * uma cor de série neutra: pintá-la de verde ou vermelho por troços tornava a
 * forma ilegível, que é a única coisa que ela tem para dar.
 *
 * **Um dia sem observações é uma interrupção na linha, não um zero.** Zero
 * milissegundos é uma afirmação absurda, e ligá-la aos vizinhos desenhava uma
 * descida que nunca aconteceu. A mesma regra da faixa de disponibilidade: não
 * ter olhado não é o mesmo que ter estado bem.
 */

const PALAVRA = { bom: 'Rápido', medio: 'Aceitável', mau: 'Lento' } as const

function ms(valor: number): string {
  return valor >= 1000 ? `${formatNumero(valor / 1000, 1)} s` : `${valor} ms`
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** «22 set». O `Intl` em pt-PT dá «22/09» com mês curto, que se lê mal num eixo. */
function dataCurta(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${Number(dia)} ${MESES[Number(mes) - 1] ?? mes}`
}

/** O semicírculo de 0 a 2,7 s, com as três zonas e o ponteiro na média. */
function Mostrador({ media }: { media: number }) {
  const classe = classeDe(media)
  const cx = 100
  const cy = 100
  const r = 80
  const ponto = (fracao: number, raio = r) => {
    const angulo = Math.PI * (1 - fracao)
    return { x: cx + raio * Math.cos(angulo), y: cy - raio * Math.sin(angulo) }
  }
  const arco = (de: number, ate: number) => {
    const a = ponto(de)
    const b = ponto(ate)
    return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 0 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`
  }
  // Um intervalo pequeno entre zonas, para se lerem como três e não como uma.
  const folga = 0.008
  const zonas = [
    { de: 0, ate: fracaoDoMostrador(RAPIDO), cor: COR_ESTADO.bom },
    { de: fracaoDoMostrador(RAPIDO), ate: fracaoDoMostrador(LENTO), cor: COR_ESTADO.medio },
    { de: fracaoDoMostrador(LENTO), ate: 1, cor: COR_ESTADO.mau },
  ]
  const fracao = fracaoDoMostrador(media)
  const ponta = ponto(fracao, r - 22)

  return (
    <svg viewBox="0 0 200 112" className="w-full max-w-[220px]" aria-hidden>
      {zonas.map((zona) => (
        <path
          key={zona.cor}
          d={arco(zona.de + (zona.de > 0 ? folga : 0), zona.ate - (zona.ate < 1 ? folga : 0))}
          fill="none"
          stroke={zona.cor}
          strokeOpacity={0.18}
          strokeWidth={16}
        />
      ))}
      {fracao > 0 ? (
        <path d={arco(0, fracao)} fill="none" stroke={COR_ESTADO[classe]} strokeWidth={16} />
      ) : null}
      <line
        x1={cx}
        y1={cy}
        x2={ponta.x}
        y2={ponta.y}
        stroke={COR_ESTADO[classe]}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={6} fill={COR_ESTADO[classe]} />
    </svg>
  )
}

export function ResponseTimeChart({ days }: { days: DiaResposta[] }) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const resumo = resumir(days)

  if (!resumo) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-400">
        Ainda não há observações suficientes para desenhar o tempo de resposta.
      </p>
    )
  }

  const classe = classeDe(resumo.media)
  const { teto, marcas } = escala(resumo.maisLento.ms)

  // Coordenadas do desenho: 1000 de largura por 300 de altura, esticadas à
  // largura da caixa. Os pontos e os rótulos são HTML posicionado em
  // percentagem, para ficarem redondos e legíveis à largura que for.
  const L = 1000
  const A = 300
  const xPct = (indice: number) => (days.length <= 1 ? 50 : (indice / (days.length - 1)) * 100)
  const yPct = (valor: number) => (1 - valor / teto) * 100
  const ponto = ({ indice, ms: valor }: { indice: number; ms: number }) => ({
    x: (xPct(indice) / 100) * L,
    y: (yPct(valor) / 100) * A,
  })

  const linhas = trocos(days).map((troco) => {
    const pontos = troco.map(ponto)
    const d = curva(pontos)
    const primeiro = pontos[0]!
    const ultimo = pontos.at(-1)!
    return {
      chave: troco[0]!.indice,
      d,
      area: pontos.length > 1 ? `${d} L${ultimo.x},${A} L${primeiro.x},${A} Z` : null,
      isolado: pontos.length === 1 ? troco[0]! : null,
    }
  })

  // Rótulos das datas: no máximo oito, sempre com o primeiro e o último.
  const saltoDatas = Math.max(1, Math.ceil(days.length / 8))
  const datas = days
    .map((dia, indice) => ({ dia, indice }))
    .filter(
      ({ indice }) =>
        indice === days.length - 1 || (indice % saltoDatas === 0 && days.length - 1 - indice >= saltoDatas * 0.75),
    )

  const diaAtivo = ativo === null ? null : days[ativo]
  const marcados = [
    { ...resumo.maisRapido, nome: 'Dia mais rápido' },
    ...(resumo.maisLento.indice !== resumo.maisRapido.indice ? [{ ...resumo.maisLento, nome: 'Dia mais lento' }] : []),
  ]

  return (
    <div className="px-5 py-4">
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-600 sm:justify-end">
        <div className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed" style={{ borderColor: COR_SERIE }} aria-hidden />
          <dt>Média de {resumo.diasComDados} {resumo.diasComDados === 1 ? 'dia' : 'dias'}</dt>
          <dd className="font-semibold tabular-nums text-ink-900">{ms(resumo.media)}</dd>
        </div>
        <div className="flex items-center gap-2 border-ink-200 sm:border-l sm:pl-5">
          <dt>Dia mais rápido</dt>
          <dd className="font-semibold tabular-nums text-ink-900">{ms(resumo.maisRapido.ms)}</dd>
        </div>
        <div className="flex items-center gap-2 border-ink-200 sm:border-l sm:pl-5">
          <dt>Dia mais lento</dt>
          <dd className="font-semibold tabular-nums text-ink-900">{ms(resumo.maisLento.ms)}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
        <div
          className="flex flex-col items-center"
          role="img"
          aria-label={`Tempo de resposta médio de ${ms(resumo.media)}, ${PALAVRA[classe].toLowerCase()}`}
          data-tempo-resposta={classe}
        >
          <Mostrador media={resumo.media} />
          <p className="-mt-1 text-3xl font-semibold tabular-nums tracking-tight" style={{ color: COR_ESTADO[classe] }}>
            {ms(resumo.media)}
          </p>
          <p className="text-xs font-medium" style={{ color: COR_ESTADO[classe] }}>
            {PALAVRA[classe]}
          </p>
          <ul className="mt-3 w-full max-w-[220px] space-y-1 text-xs text-ink-600">
            {(
              [
                ['bom', `abaixo de ${RAPIDO} ms`],
                ['medio', `${RAPIDO} ms a ${formatNumero(LENTO / 1000, 1)} s`],
                ['mau', `acima de ${formatNumero(LENTO / 1000, 1)} s`],
              ] as const
            ).map(([chave, intervalo]) => (
              <li key={chave} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COR_ESTADO[chave] }} />
                  {PALAVRA[chave]}
                </span>
                <span className="tabular-nums text-ink-400">{intervalo}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-w-0 gap-2">
          {/* Eixo vertical, em HTML para os números não se esticarem com o desenho. */}
          <div className="relative h-56 w-12 shrink-0 text-right text-[11px] tabular-nums text-ink-400" aria-hidden>
            {marcas.map((marca) => (
              <span key={marca} className="absolute right-0 -translate-y-1/2" style={{ top: `${yPct(marca)}%` }}>
                {ms(marca)}
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="relative h-56">
              <svg
                viewBox={`0 0 ${L} ${A}`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full overflow-visible"
                role="img"
                aria-label={`Tempo de resposta diário ao longo de ${days.length} dias: média ${ms(resumo.media)}, dia mais rápido ${ms(resumo.maisRapido.ms)}, dia mais lento ${ms(resumo.maisLento.ms)}`}
              >
                <defs>
                  <linearGradient id="tempo-resposta-area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={COR_SERIE} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={COR_SERIE} stopOpacity={0.01} />
                  </linearGradient>
                </defs>

                {marcas.map((marca) => (
                  <line
                    key={marca}
                    x1={0}
                    x2={L}
                    y1={(yPct(marca) / 100) * A}
                    y2={(yPct(marca) / 100) * A}
                    stroke="#e6e3de"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {linhas.map((linha) =>
                  linha.area ? (
                    <path key={`a${linha.chave}`} d={linha.area} fill="url(#tempo-resposta-area)" stroke="none" />
                  ) : null,
                )}

                <line
                  x1={0}
                  x2={L}
                  y1={(yPct(resumo.media) / 100) * A}
                  y2={(yPct(resumo.media) / 100) * A}
                  stroke={COR_SERIE}
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                  vectorEffect="non-scaling-stroke"
                />

                {linhas.map((linha) => (
                  <path
                    key={`l${linha.chave}`}
                    d={linha.d}
                    fill="none"
                    stroke={COR_SERIE}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>

              {/* Um dia isolado, sem vizinhos, não faz linha: fica um ponto. */}
              {linhas
                .filter((linha) => linha.isolado)
                .map((linha) => (
                  <span
                    key={`p${linha.chave}`}
                    className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ left: `${xPct(linha.isolado!.indice)}%`, top: `${yPct(linha.isolado!.ms)}%`, backgroundColor: COR_SERIE }}
                  />
                ))}

              {marcados.map((marca) => (
                <span
                  key={marca.nome}
                  title={`${marca.nome}: ${ms(marca.ms)}`}
                  data-marca={marca.nome}
                  className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white"
                  style={{ left: `${xPct(marca.indice)}%`, top: `${yPct(marca.ms)}%`, borderColor: COR_SERIE }}
                />
              ))}

              {diaAtivo ? (
                <>
                  <span
                    className="pointer-events-none absolute inset-y-0 w-px bg-ink-200"
                    style={{ left: `${xPct(ativo!)}%` }}
                  />
                  {diaAtivo.average !== null ? (
                    <span
                      className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                      style={{ left: `${xPct(ativo!)}%`, top: `${yPct(diaAtivo.average)}%`, backgroundColor: COR_SERIE }}
                    />
                  ) : null}
                  <div
                    className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-raised"
                    style={
                      xPct(ativo!) > 60
                        ? { right: `${100 - xPct(ativo!)}%`, marginRight: 10 }
                        : { left: `${xPct(ativo!)}%`, marginLeft: 10 }
                    }
                  >
                    <p className="font-semibold text-ink-900">{dataCurta(diaAtivo.day)}</p>
                    {diaAtivo.average === null ? (
                      <p className="text-ink-400">Sem observações</p>
                    ) : (
                      <>
                        <p className="mt-0.5 flex justify-between gap-3 text-ink-600">
                          Média <span className="font-semibold tabular-nums text-ink-900">{ms(diaAtivo.average)}</span>
                        </p>
                        <p className="flex justify-between gap-3 text-ink-600">
                          Pior <span className="tabular-nums text-ink-900">{ms(diaAtivo.slowest ?? diaAtivo.average)}</span>
                        </p>
                        <p className="text-ink-400">
                          {diaAtivo.samples} {diaAtivo.samples === 1 ? 'observação' : 'observações'}
                        </p>
                      </>
                    )}
                  </div>
                </>
              ) : null}

              {/* Alvos de leitura: uma coluna por dia, larga o suficiente para o dedo. */}
              <div className="absolute inset-0 flex" onMouseLeave={() => setAtivo(null)}>
                {days.map((dia, indice) => (
                  <button
                    key={dia.day}
                    type="button"
                    aria-label={`${dataCurta(dia.day)}: ${dia.average === null ? 'sem observações' : `média ${ms(dia.average)}`}`}
                    onMouseEnter={() => setAtivo(indice)}
                    onFocus={() => setAtivo(indice)}
                    onBlur={() => setAtivo(null)}
                    onClick={() => setAtivo(indice)}
                    className="h-full flex-1 cursor-default focus:outline-none"
                  />
                ))}
              </div>
            </div>

            <div className="relative mt-2 h-4 text-[11px] text-ink-400" aria-hidden>
              {datas.map(({ dia, indice }) => (
                <span
                  key={dia.day}
                  className={`absolute whitespace-nowrap ${
                    indice === 0 ? '' : indice === days.length - 1 ? '-translate-x-full font-semibold text-ink-900' : '-translate-x-1/2'
                  }`}
                  style={{ left: `${xPct(indice)}%` }}
                >
                  {dataCurta(dia.day)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <details className="mt-4 text-xs text-ink-600">
        <summary className="cursor-pointer text-ink-400 hover:text-ink-600">Ver os valores dia a dia</summary>
        <table className="mt-2 w-full max-w-md tabular-nums">
          <thead className="text-left text-ink-400">
            <tr>
              <th className="py-1 font-medium">Dia</th>
              <th className="py-1 text-right font-medium">Média</th>
              <th className="py-1 text-right font-medium">Pior</th>
              <th className="py-1 text-right font-medium">Observações</th>
            </tr>
          </thead>
          <tbody>
            {days.map((dia) => (
              <tr key={dia.day} className="border-t border-ink-100">
                <td className="py-1">{dataCurta(dia.day)}</td>
                <td className="py-1 text-right">{dia.average === null ? '—' : ms(dia.average)}</td>
                <td className="py-1 text-right">{dia.slowest === null ? '—' : ms(dia.slowest)}</td>
                <td className="py-1 text-right">{dia.samples}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
