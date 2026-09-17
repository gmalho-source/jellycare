import { describe, expect, it } from 'vitest'
import { monthPeriod } from './period.js'
import { summariseUptime, type UptimeSample } from './uptime.js'

const PERIOD = monthPeriod(2026, 6, 'Europe/Lisbon')
const INTERVAL = 5 * 60_000

/** Amostras de cinco em cinco minutos a partir do início do período. */
function series(pattern: readonly (boolean | { up: boolean; reason?: string; ms?: number })[]) {
  return pattern.map((entry, index): UptimeSample => {
    const normalised = typeof entry === 'boolean' ? { up: entry } : entry
    const sample: UptimeSample = {
      observedAt: new Date(PERIOD.start.getTime() + index * INTERVAL),
      up: normalised.up,
    }
    if (normalised.reason) sample.failureReason = normalised.reason
    if (normalised.ms !== undefined) sample.responseTimeMs = normalised.ms
    return sample
  })
}

function summarise(samples: UptimeSample[], options: Record<string, unknown> = {}) {
  return summariseUptime(samples, { period: PERIOD, expectedIntervalMs: INTERVAL, ...options })
}

describe('summariseUptime', () => {
  it('não inventa números sem amostras', () => {
    const summary = summarise([])

    expect(summary.uptimePercent).toBeNull()
    expect(summary.slaMet).toBeNull()
    expect(summary.coverage).toBeNull()
    expect(summary.incidents).toEqual([])
  })

  it('calcula a percentagem de disponibilidade', () => {
    const summary = summarise(series([true, true, true, false]))
    expect(summary.uptimePercent).toBe(75)
    expect(summary.upSamples).toBe(3)
  })

  it('agrupa falhas consecutivas numa única interrupção', () => {
    const summary = summarise(series([true, false, false, false, true, true]))

    expect(summary.incidents).toHaveLength(1)
    // Da primeira falha até à recuperação: três intervalos.
    expect(summary.incidents[0]?.durationMs).toBe(3 * INTERVAL)
    expect(summary.totalDowntimeMs).toBe(3 * INTERVAL)
  })

  it('separa interrupções distintas', () => {
    const summary = summarise(series([false, true, true, false, true]))

    expect(summary.incidents).toHaveLength(2)
    expect(summary.longestIncidentMs).toBe(INTERVAL)
  })

  it('guarda a causa mais frequente da interrupção', () => {
    const summary = summarise(
      series([
        true,
        { up: false, reason: 'HTTP 503' },
        { up: false, reason: 'HTTP 503' },
        { up: false, reason: 'timeout' },
        true,
      ]),
    )

    expect(summary.incidents[0]?.reason).toBe('HTTP 503')
  })

  it('não trata uma lacuna na monitorização como site em baixo', () => {
    // Duas falhas separadas por seis horas sem amostras: não sabemos o que
    // aconteceu no meio, e dizer que esteve seis horas em baixo seria inventar.
    const samples: UptimeSample[] = [
      { observedAt: new Date(PERIOD.start.getTime()), up: false },
      { observedAt: new Date(PERIOD.start.getTime() + 6 * 3_600_000), up: false },
      { observedAt: new Date(PERIOD.start.getTime() + 6 * 3_600_000 + INTERVAL), up: true },
    ]

    const summary = summarise(samples)

    expect(summary.incidents).toHaveLength(2)
    expect(summary.totalDowntimeMs).toBe(2 * INTERVAL)
  })

  it('marca como em curso a interrupção que não recuperou', () => {
    const summary = summarise(series([true, false, false]))

    expect(summary.incidents[0]?.ongoing).toBe(true)
    expect(summary.incidents).toHaveLength(1)
  })

  it('dá duração mínima de um intervalo a uma falha isolada', () => {
    const summary = summarise(series([false]))

    expect(summary.incidents[0]?.durationMs).toBe(INTERVAL)
  })

  it('calcula o tempo de resposta médio ignorando as falhas', () => {
    const summary = summarise(
      series([{ up: true, ms: 100 }, { up: true, ms: 300 }, { up: false }]),
    )

    expect(summary.averageResponseTimeMs).toBe(200)
  })

  it('ignora amostras fora do período', () => {
    const summary = summarise([
      { observedAt: new Date(PERIOD.start.getTime() - 3_600_000), up: false },
      { observedAt: new Date(PERIOD.start.getTime()), up: true },
      { observedAt: new Date(PERIOD.end.getTime() + 3_600_000), up: false },
    ])

    expect(summary.samples).toBe(1)
    expect(summary.uptimePercent).toBe(100)
  })

  it('avalia o SLA quando há observação suficiente', () => {
    const total = Math.round((PERIOD.end.getTime() - PERIOD.start.getTime()) / INTERVAL)
    const samples = series(Array.from({ length: total }, () => true))

    const summary = summarise(samples, { slaTarget: 99.9 })
    expect(summary.coverage).toBe(1)
    expect(summary.slaMet).toBe(true)
  })

  it('não afirma o cumprimento do SLA com pouca observação', () => {
    // Uma percentagem calculada sobre meia dúzia de amostras parece mais firme
    // do que é; o relatório tem de o dizer em vez de a apresentar como facto.
    const summary = summarise(series([true, true, true]), { slaTarget: 99.9 })

    expect(summary.uptimePercent).toBe(100)
    expect(summary.slaMet).toBeNull()
    expect(summary.coverage).toBeLessThan(0.1)
  })

  it('reporta incumprimento quando fica abaixo do contratado', () => {
    const total = Math.round((PERIOD.end.getTime() - PERIOD.start.getTime()) / INTERVAL)
    const pattern = Array.from({ length: total }, (_, index) => index % 50 !== 0)

    const summary = summarise(series(pattern), { slaTarget: 99.9 })
    expect(summary.slaMet).toBe(false)
  })

  it('ordena amostras que cheguem trocadas', () => {
    const summary = summarise([
      { observedAt: new Date(PERIOD.start.getTime() + INTERVAL), up: true },
      { observedAt: new Date(PERIOD.start.getTime()), up: false },
    ])

    expect(summary.incidents).toHaveLength(1)
    expect(summary.incidents[0]?.start).toEqual(PERIOD.start)
  })
})
