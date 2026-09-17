import { createHash } from 'node:crypto'

export interface SchedulableCheck {
  id: string
  siteId: string
  checkType: string
  enabled: boolean
  intervalMinutes: number
  nextRunAt: Date | null
}

export interface MaintenanceWindow {
  start: string
  end: string
}

const MINUTE_MS = 60_000

/**
 * Deslocamento estável entre 0 e 1 para um par site/check.
 *
 * Sem isto, todos os checks diários de todos os sites disparam à mesma hora e
 * a plataforma bate em dezenas de sites do mesmo alojamento ao mesmo segundo —
 * o que se parece com um ataque e trata o cliente pior do que qualquer bot.
 */
export function deterministicPhase(seed: string): number {
  const digest = createHash('sha256').update(seed).digest()
  // Quatro bytes chegam para espalhar e mantêm a conta em inteiros seguros.
  const value = digest.readUInt32BE(0)
  return value / 0x1_0000_0000
}

export interface NextRunOptions {
  /** Fração do intervalo usada como janela de dispersão. */
  jitterRatio?: number
  /** Limite superior da dispersão, para intervalos longos. */
  maxJitterMs?: number
}

/**
 * Quando deve correr a próxima vez.
 *
 * O deslocamento é determinístico por site e por check: o mesmo site mantém a
 * sua posição na hora entre execuções, em vez de andar a saltar.
 */
export function computeNextRun(
  check: Pick<SchedulableCheck, 'siteId' | 'checkType' | 'intervalMinutes'>,
  now: Date,
  options: NextRunOptions = {},
): Date {
  const intervalMs = Math.max(1, check.intervalMinutes) * MINUTE_MS
  const jitterRatio = options.jitterRatio ?? 0.1
  const maxJitterMs = options.maxJitterMs ?? 10 * MINUTE_MS

  const window = Math.min(intervalMs * jitterRatio, maxJitterMs)
  const phase = deterministicPhase(`${check.siteId}:${check.checkType}`)
  const offset = (phase - 0.5) * 2 * window

  // Nunca antecipar para menos de metade do intervalo: a dispersão não pode
  // transformar um check horário num check de vinte minutos.
  const delay = Math.max(intervalMs / 2, intervalMs + offset)
  return new Date(now.getTime() + Math.round(delay))
}

export function isDue(check: SchedulableCheck, now: Date): boolean {
  if (!check.enabled) return false
  // Um check nunca executado corre já: é o primeiro run depois do onboarding.
  if (check.nextRunAt === null) return true
  return check.nextRunAt.getTime() <= now.getTime()
}

/**
 * Seleciona o que está vencido, do mais atrasado para o menos.
 *
 * Ordenar por atraso evita que um pico de trabalho deixe sempre os mesmos
 * checks para trás — sem isto, um site com muitos checks pode nunca chegar à
 * frente da fila.
 */
export function selectDue(
  checks: readonly SchedulableCheck[],
  now: Date,
  limit: number,
): SchedulableCheck[] {
  return checks
    .filter((check) => isDue(check, now))
    .sort((a, b) => {
      const aTime = a.nextRunAt?.getTime() ?? 0
      const bTime = b.nextRunAt?.getTime() ?? 0
      return aTime - bTime
    })
    .slice(0, limit)
}

/** O site está numa janela de manutenção declarada? */
export function isInMaintenanceWindow(
  windows: readonly MaintenanceWindow[],
  now: Date,
): boolean {
  const time = now.getTime()
  return windows.some((window) => {
    const start = Date.parse(window.start)
    const end = Date.parse(window.end)
    if (Number.isNaN(start) || Number.isNaN(end)) return false
    return time >= start && time <= end
  })
}

/**
 * Atraso a aplicar a um job para espalhar um lote no tempo.
 *
 * Quando o scheduler acorda com cem checks vencidos, enviá-los todos de
 * imediato cria um pico contra os sites e contra a nossa própria rede.
 */
export function batchDelayMs(index: number, batchSize: number, spreadMs: number): number {
  if (batchSize <= 1) return 0
  return Math.round((index / batchSize) * spreadMs)
}
