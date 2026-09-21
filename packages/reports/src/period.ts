/**
 * Períodos do relatório, no fuso do cliente.
 *
 * O relatório cobre "o mês anterior" tal como o cliente o entende, não o mês
 * em UTC. Em Portugal isso significa que o relatório de março começa e acaba
 * em instantes UTC diferentes consoante a mudança da hora — e um relatório
 * cujos números mudam com a hora de verão é um relatório em que ninguém
 * confia.
 */

export interface ReportPeriod {
  /** Primeiro instante do período, em UTC. */
  start: Date
  /** Primeiro instante do período seguinte, em UTC. Exclusivo. */
  end: Date
  /** Ano e mês no fuso do cliente. */
  year: number
  /** 1 a 12. */
  month: number
  /** Rótulo em português, ex. "março de 2026". */
  label: string
}

export const DEFAULT_TIME_ZONE = 'Europe/Lisbon'

const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** Desvio do fuso, em minutos, no instante indicado. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  // `en-US` com `timeZoneName: shortOffset` devolve algo como "GMT+1".
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
  const part = formatter.formatToParts(instant).find((entry) => entry.type === 'timeZoneName')
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part?.value ?? '')
  if (!match) return 0

  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3]))
}

/**
 * Instante UTC correspondente à meia-noite local do primeiro dia do mês.
 *
 * Duas passagens: a primeira estima o desvio, a segunda confirma-o já perto do
 * instante certo. Sem a segunda, uma mudança de hora entre a estimativa e o
 * resultado dava um erro de sessenta minutos.
 */
export function startOfMonthUtc(year: number, month: number, timeZone: string): Date {
  const naive = Date.UTC(year, month - 1, 1, 0, 0, 0, 0)
  const firstGuess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000)
  return new Date(naive - zoneOffsetMinutes(firstGuess, timeZone) * 60_000)
}

/** Ano e mês de um instante, no fuso indicado. */
export function zonedYearMonth(
  instant: Date,
  timeZone: string,
): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instant)

  const year = Number(parts.find((entry) => entry.type === 'year')?.value)
  const month = Number(parts.find((entry) => entry.type === 'month')?.value)
  return { year, month }
}

export function monthPeriod(
  year: number,
  month: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): ReportPeriod {
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1

  return {
    start: startOfMonthUtc(year, month, timeZone),
    end: startOfMonthUtc(nextYear, nextMonth, timeZone),
    year,
    month,
    label: `${MONTHS_PT[month - 1]} de ${year}`,
  }
}

/** O mês anterior ao instante de referência, no fuso do cliente. */
export function previousMonth(
  reference: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): ReportPeriod {
  const { year, month } = zonedYearMonth(reference, timeZone)
  const previousYear = month === 1 ? year - 1 : year
  const previousMonthNumber = month === 1 ? 12 : month - 1
  return monthPeriod(previousYear, previousMonthNumber, timeZone)
}

/** Duração do período, em milissegundos. Varia com o mês e com a hora de verão. */
export function periodDurationMs(period: ReportPeriod): number {
  return period.end.getTime() - period.start.getTime()
}
