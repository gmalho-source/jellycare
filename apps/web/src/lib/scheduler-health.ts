import { schema } from '@jellycare/db'
import { eq } from 'drizzle-orm'
import { getDb } from './db'

/**
 * O agendador está vivo?
 *
 * A regra vive aqui e não no endpoint porque tem dois leitores: o vigia de
 * fora, que só quer um código HTTP, e o painel, que precisa de saber a mesma
 * coisa para não afirmar que está tudo bem. Duas cópias da regra divergiriam,
 * e a que divergisse seria a do painel — a que as pessoas veem.
 */

/**
 * A partir de quando é que o silêncio é avaria.
 *
 * O ciclo corre de 30 em 30 segundos. Cinco minutos são dez passagens
 * falhadas: folga que chega para um deploy ou um reinício, e pouca para uma
 * avaria passar despercebida. A paragem que motivou isto durou dezoito horas.
 */
export const STALE_AFTER_MS = 5 * 60_000

export type SchedulerStatus = 'ok' | 'stale' | 'failing' | 'unknown'

export interface SchedulerHealth {
  status: SchedulerStatus
  /** Segundos desde a última passagem. Nulo quando nunca houve nenhuma. */
  ageSeconds: number | null
  lastTickAt: Date | null
  lastHealthyTickAt: Date | null
  lastEnqueueAt: Date | null
  lastError: string | null
  lastErrorAt: Date | null
}

export async function getSchedulerHealth(now = new Date()): Promise<SchedulerHealth> {
  const db = getDb()

  const rows = await db
    .select()
    .from(schema.schedulerHeartbeats)
    .where(eq(schema.schedulerHeartbeats.id, 'checks'))
    .limit(1)

  const batida = rows[0]

  // Sem batida: ou o worker nunca arrancou com esta versão, ou não arranca.
  // Não é `ok` — não sabemos nada, e não saber é precisamente o estado que
  // isto existe para não deixar passar por bom.
  if (!batida) {
    return {
      status: 'unknown',
      ageSeconds: null,
      lastTickAt: null,
      lastHealthyTickAt: null,
      lastEnqueueAt: null,
      lastError: null,
      lastErrorAt: null,
    }
  }

  const ageMs = now.getTime() - batida.lastTickAt.getTime()

  // Três estados e não dois. «A passar mas a falhar» é o que aconteceu com o
  // Redis esgotado: o ciclo continuou vivo, de trinta em trinta segundos,
  // dezoito horas a fio, sem pôr nada na fila. Um sinal de vida que só
  // perguntasse «passou?» teria respondido «sim» o tempo todo.
  const status: SchedulerStatus =
    ageMs > STALE_AFTER_MS ? 'stale' : batida.lastError !== null ? 'failing' : 'ok'

  return {
    status,
    ageSeconds: Math.round(ageMs / 1000),
    lastTickAt: batida.lastTickAt,
    lastHealthyTickAt: batida.lastHealthyTickAt,
    lastEnqueueAt: batida.lastEnqueueAt,
    lastError: batida.lastError,
    lastErrorAt: batida.lastErrorAt,
  }
}
