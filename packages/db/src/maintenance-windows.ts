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
