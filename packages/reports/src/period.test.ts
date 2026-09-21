import { describe, expect, it } from 'vitest'
import {
  monthPeriod,
  periodDurationMs,
  previousMonth,
  startOfMonthUtc,
  zoneOffsetMinutes,
  zonedYearMonth,
} from './period.js'

const LISBOA = 'Europe/Lisbon'
const DUBAI = 'Asia/Dubai'

describe('zoneOffsetMinutes', () => {
  it('lê o desvio de inverno e de verão em Lisboa', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), LISBOA)).toBe(0)
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), LISBOA)).toBe(60)
  })

  it('lê um fuso sem hora de verão', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), DUBAI)).toBe(240)
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), DUBAI)).toBe(240)
  })
})

describe('startOfMonthUtc', () => {
  it('em Lisboa, janeiro começa à meia-noite UTC', () => {
    expect(startOfMonthUtc(2026, 1, LISBOA).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('em Lisboa, julho começa uma hora antes em UTC', () => {
    // Hora de verão: meia-noite em Lisboa é 23:00 UTC do dia anterior.
    expect(startOfMonthUtc(2026, 7, LISBOA).toISOString()).toBe('2026-06-30T23:00:00.000Z')
  })

  it('acerta no mês em que a hora muda', () => {
    // A mudança para a hora de verão é a 29 de março de 2026; o dia 1 ainda é
    // hora de inverno, e é o dia 1 que define o início do período.
    expect(startOfMonthUtc(2026, 3, LISBOA).toISOString()).toBe('2026-03-01T00:00:00.000Z')
    // Outubro começa ainda em hora de verão.
    expect(startOfMonthUtc(2026, 10, LISBOA).toISOString()).toBe('2026-09-30T23:00:00.000Z')
  })

  it('acerta num fuso à frente de UTC', () => {
    expect(startOfMonthUtc(2026, 3, DUBAI).toISOString()).toBe('2026-02-28T20:00:00.000Z')
  })
})

describe('zonedYearMonth', () => {
  it('usa o fuso e não UTC', () => {
    // 23:30 UTC de 31 de julho já é 1 de agosto em Lisboa.
    expect(zonedYearMonth(new Date('2026-07-31T23:30:00Z'), LISBOA)).toEqual({
      year: 2026,
      month: 8,
    })
  })
})

describe('monthPeriod', () => {
  it('cobre o mês inteiro, com fim exclusivo', () => {
    const period = monthPeriod(2026, 2, LISBOA)

    expect(period.start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(period.label).toBe('fevereiro de 2026')
  })

  it('passa de dezembro para janeiro do ano seguinte', () => {
    const period = monthPeriod(2026, 12, LISBOA)

    expect(period.end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(period.label).toBe('dezembro de 2026')
  })
})

describe('previousMonth', () => {
  it('devolve o mês anterior ao de referência', () => {
    const period = previousMonth(new Date('2026-09-17T10:00:00Z'), LISBOA)

    expect(period.label).toBe('agosto de 2026')
    expect(period.start.toISOString()).toBe('2026-07-31T23:00:00.000Z')
  })

  it('recua o ano em janeiro', () => {
    const period = previousMonth(new Date('2026-01-03T10:00:00Z'), LISBOA)
    expect(period.label).toBe('dezembro de 2025')
  })

  it('usa o mês local, não o UTC, na viragem do mês', () => {
    // 1 de agosto às 00:30 em Lisboa é 31 de julho às 23:30 em UTC. O relatório
    // a gerar é o de julho, não o de junho.
    const period = previousMonth(new Date('2026-07-31T23:30:00Z'), LISBOA)
    expect(period.label).toBe('julho de 2026')
  })
})

describe('periodDurationMs', () => {
  it('conta menos uma hora no mês em que a hora avança', () => {
    const marco = periodDurationMs(monthPeriod(2026, 3, LISBOA))
    expect(marco).toBe(31 * 24 * 3_600_000 - 3_600_000)
  })

  it('conta mais uma hora no mês em que a hora recua', () => {
    const outubro = periodDurationMs(monthPeriod(2026, 10, LISBOA))
    expect(outubro).toBe(31 * 24 * 3_600_000 + 3_600_000)
  })

  it('conta certo num mês sem mudança de hora', () => {
    expect(periodDurationMs(monthPeriod(2026, 6, LISBOA))).toBe(30 * 24 * 3_600_000)
  })
})
