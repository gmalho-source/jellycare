/**
 * Janelas de manutenção declaradas.
 *
 * Durante uma janela, os alertas não são enviados — mas as verificações
 * continuam a correr e os problemas continuam a ser registados. É deliberado:
 * um deploy planeado não deve acordar ninguém de madrugada, e também não deve
 * criar um buraco no histórico em que ninguém sabe o que aconteceu.
 *
 * O mecanismo existia e era respeitado pelo worker desde o início. O que não
 * existia era forma de declarar uma janela sem um `update` à mão na base de
 * dados, o que é o mesmo que não existir.
 */

export interface MaintenanceWindow {
  /** Instante ISO 8601, em UTC. */
  start: string
  end: string
}

/**
 * Quantas janelas se guardam por site.
 *
 * Chega para a manutenção planeada de um trimestre. Quem precisar de mais do
 * que isto não quer janelas, quer o site em pausa — e isso já existe.
 */
export const MAX_MAINTENANCE_WINDOWS = 10

/** Uma janela não pode ser mais longa do que isto. */
export const MAX_WINDOW_DAYS = 14

export interface MaintenanceWindowsResult {
  windows: MaintenanceWindow[]
  error?: string
}

function isoOrNull(value: string): string | null {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

/**
 * Janelas que já terminaram.
 *
 * Não são apagadas por si sós: uma janela terminada ontem explica porque é
 * que não houve alerta ontem, e isso é uma pergunta que se faz. Passam a ser
 * removidas quando a lista é escrita, que é quando alguém está a olhar para
 * ela — e depois de um mês, que chega para a pergunta ser feita.
 */
export const KEEP_ENDED_DAYS = 30

export function pruneEndedWindows(
  windows: readonly MaintenanceWindow[],
  now: Date = new Date(),
): MaintenanceWindow[] {
  const cutoff = now.getTime() - KEEP_ENDED_DAYS * 24 * 3600_000
  return windows.filter((window) => {
    const end = Date.parse(window.end)
    return Number.isNaN(end) ? false : end >= cutoff
  })
}

/**
 * Valida e normaliza uma janela nova, e junta-a às que já existem.
 *
 * A sobreposição é aceite de propósito. Duas janelas que se cruzam não são um
 * erro — são duas equipas a declarar trabalho na mesma noite — e recusá-las
 * obrigava a quem chegasse em segundo lugar a apagar o trabalho do primeiro.
 */
export function addMaintenanceWindow(
  existing: readonly MaintenanceWindow[],
  input: { start: string; end: string },
  now: Date = new Date(),
): MaintenanceWindowsResult {
  const start = isoOrNull(input.start)
  const end = isoOrNull(input.end)

  if (!start || !end) {
    return { windows: [...existing], error: 'Datas inválidas.' }
  }

  const startMs = Date.parse(start)
  const endMs = Date.parse(end)

  if (endMs <= startMs) {
    return { windows: [...existing], error: 'O fim tem de ser depois do início.' }
  }

  if (endMs - startMs > MAX_WINDOW_DAYS * 24 * 3600_000) {
    return {
      windows: [...existing],
      error: `Uma janela não pode durar mais de ${MAX_WINDOW_DAYS} dias. Para parar a vigilância por mais tempo, ponha o site em pausa.`,
    }
  }

  // Uma janela que já terminou não silencia nada: só serviria para dar a
  // impressão de que se declarou alguma coisa.
  if (endMs <= now.getTime()) {
    return { windows: [...existing], error: 'Essa janela já terminou.' }
  }

  const vivas = pruneEndedWindows(existing, now)

  if (vivas.some((window) => window.start === start && window.end === end)) {
    return { windows: vivas, error: 'Essa janela já está declarada.' }
  }

  if (vivas.length >= MAX_MAINTENANCE_WINDOWS) {
    return {
      windows: vivas,
      error: `Já há ${MAX_MAINTENANCE_WINDOWS} janelas declaradas. Remova uma antes de acrescentar outra.`,
    }
  }

  return { windows: sortWindows([...vivas, { start, end }]) }
}

export function removeMaintenanceWindow(
  existing: readonly MaintenanceWindow[],
  target: { start: string; end: string },
): MaintenanceWindow[] {
  return existing.filter(
    (window) => !(window.start === target.start && window.end === target.end),
  )
}

function sortWindows(windows: MaintenanceWindow[]): MaintenanceWindow[] {
  return [...windows].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

export type WindowState = 'a decorrer' | 'agendada' | 'terminada'

export function windowState(window: MaintenanceWindow, now: Date = new Date()): WindowState {
  const time = now.getTime()
  const start = Date.parse(window.start)
  const end = Date.parse(window.end)
  if (Number.isNaN(start) || Number.isNaN(end)) return 'terminada'
  if (time < start) return 'agendada'
  return time <= end ? 'a decorrer' : 'terminada'
}

/* -------------------------------------------------------------------------- */
/* Janela recorrente                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A janela que se repete todas as semanas.
 *
 * Existe porque as janelas avulsas não servem para manutenção automática:
 * obrigavam alguém a declarar uma data de cada vez, o que é o contrário de
 * automático. Um serviço gerido tem um horário de manutenção, não uma série
 * de autorizações pontuais.
 *
 * O fuso é guardado como nome IANA e não como diferença horária, de propósito:
 * «três da manhã em Lisboa» continua a ser três da manhã depois da mudança da
 * hora, e uma diferença fixa não continuava.
 */
export interface MaintenanceSchedule {
  /** 0 = domingo … 6 = sábado. Vazio significa todos os dias. */
  weekdays: number[]
  /** Hora local de início. */
  hour: number
  minute: number
  durationMinutes: number
  /** Nome IANA, por exemplo `Europe/Lisbon`. */
  timezone: string
}

export const MIN_SCHEDULE_MINUTES = 15
export const MAX_SCHEDULE_MINUTES = 60 * 12

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A hora local, no fuso pedido, do instante dado. */
function partesLocais(now: Date, timezone: string): { weekday: number; minutes: number } | null {
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)

    const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? ''
    const weekday = DIAS.indexOf(valor('weekday'))
    // `hour12: false` devolve 24 à meia-noite em alguns runtimes.
    const hora = Number(valor('hour')) % 24
    const minuto = Number(valor('minute'))

    if (weekday < 0 || Number.isNaN(hora) || Number.isNaN(minuto)) return null
    return { weekday, minutes: hora * 60 + minuto }
  } catch {
    // Fuso inválido. Devolver nulo faz a janela nunca abrir, que é o lado
    // seguro: uma configuração que não se entende não autoriza mexer no site
    // de ninguém.
    return null
  }
}

export function isInRecurringWindow(
  schedule: MaintenanceSchedule | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!schedule) return false
  if (schedule.durationMinutes <= 0) return false

  const local = partesLocais(now, schedule.timezone)
  if (!local) return false

  const inicio = schedule.hour * 60 + schedule.minute
  const fim = inicio + schedule.durationMinutes
  const permitido = (dia: number) =>
    schedule.weekdays.length === 0 || schedule.weekdays.includes(dia)

  // A janela que começou hoje.
  if (permitido(local.weekday) && local.minutes >= inicio && local.minutes < fim) return true

  // A que começou ontem e atravessou a meia-noite. Os 1440 minutos são uma
  // aproximação: no dia da mudança da hora um dia local tem 23 ou 25 horas, e
  // nessa noite a janela pode abrir ou fechar uma hora ao lado. Para uma
  // janela de manutenção é aceitável; para o cálculo de disponibilidade não
  // seria, e por isso esse não usa isto.
  const ontem = (local.weekday + 6) % 7
  if (permitido(ontem) && local.minutes + 1440 >= inicio && local.minutes + 1440 < fim) {
    return true
  }

  return false
}

export interface ScheduleResult {
  schedule: MaintenanceSchedule | null
  error?: string
}

export function parseMaintenanceSchedule(input: {
  weekdays?: unknown
  hour?: unknown
  minute?: unknown
  durationMinutes?: unknown
  timezone?: unknown
}): ScheduleResult {
  const hour = Number(input.hour)
  const minute = Number(input.minute ?? 0)
  const durationMinutes = Number(input.durationMinutes)
  const timezone = String(input.timezone ?? '').trim()

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { schedule: null, error: 'Hora inválida.' }
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { schedule: null, error: 'Minutos inválidos.' }
  }
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < MIN_SCHEDULE_MINUTES ||
    durationMinutes > MAX_SCHEDULE_MINUTES
  ) {
    return {
      schedule: null,
      error: `A duração tem de estar entre ${MIN_SCHEDULE_MINUTES} minutos e ${MAX_SCHEDULE_MINUTES / 60} horas.`,
    }
  }
  if (timezone.length === 0 || partesLocais(new Date(), timezone) === null) {
    return { schedule: null, error: 'Fuso horário inválido.' }
  }

  const bruto = Array.isArray(input.weekdays) ? input.weekdays : []
  const weekdays = [...new Set(bruto.map(Number))]
    .filter((dia) => Number.isInteger(dia) && dia >= 0 && dia <= 6)
    .sort((a, b) => a - b)

  return { schedule: { weekdays, hour, minute, durationMinutes, timezone } }
}

/** Autorizado a mexer agora: por janela avulsa ou pelo horário recorrente. */
export function isInAnyMaintenanceWindow(
  windows: readonly MaintenanceWindow[],
  schedule: MaintenanceSchedule | null | undefined,
  now: Date = new Date(),
): boolean {
  const time = now.getTime()
  const avulsa = windows.some((window) => {
    const start = Date.parse(window.start)
    const end = Date.parse(window.end)
    if (Number.isNaN(start) || Number.isNaN(end)) return false
    return time >= start && time <= end
  })

  return avulsa || isInRecurringWindow(schedule, now)
}
