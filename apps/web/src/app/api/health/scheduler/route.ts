import { schema } from '@jellycare/db'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * O agendador está vivo?
 *
 * Público e sem sessão, de propósito. Quem tem de fazer esta pergunta é um
 * vigia de fora — um workflow agendado, um serviço de uptime — e obrigá-lo a
 * autenticar-se era pôr mais uma peça entre a avaria e o aviso. Não devolve
 * nada sobre sites nem clientes: só instantes e contagens da própria
 * plataforma.
 *
 * Servido pelo dashboard e não pelo worker. Um sinal de vida respondido pelo
 * processo que ele vigia morre com ele, e a pergunta fica sem resposta
 * exatamente quando a resposta importa.
 */

/**
 * A partir de quando é que o silêncio é avaria.
 *
 * O ciclo corre de 30 em 30 segundos. Cinco minutos são dez passagens
 * falhadas — folga que chega para um deploy, um reinício ou um soluço de
 * rede, e pouca para uma avaria passar despercebida. A paragem que motivou
 * isto durou dezoito horas.
 */
export const STALE_AFTER_MS = 5 * 60_000

export interface SchedulerHealth {
  status: 'ok' | 'stale' | 'failing' | 'unknown'
  /** Segundos desde a última passagem. Nulo quando nunca houve nenhuma. */
  ageSeconds: number | null
  lastTickAt: string | null
  lastHealthyTickAt: string | null
  lastEnqueueAt: string | null
  lastError: string | null
  lastErrorAt: string | null
}

export async function GET(): Promise<NextResponse> {
  const db = getDb()

  const rows = await db
    .select()
    .from(schema.schedulerHeartbeats)
    .where(eq(schema.schedulerHeartbeats.id, 'checks'))
    .limit(1)

  const batida = rows[0]

  // Sem batida nenhuma: ou o worker nunca arrancou com esta versão, ou não
  // arranca de todo. Não é `ok` — não sabemos nada, e não saber é o estado
  // que este endpoint existe para não deixar passar por bom.
  if (!batida) {
    return NextResponse.json(
      {
        status: 'unknown',
        ageSeconds: null,
        lastTickAt: null,
        lastHealthyTickAt: null,
        lastEnqueueAt: null,
        lastError: null,
        lastErrorAt: null,
      } satisfies SchedulerHealth,
      { status: 503 },
    )
  }

  const ageMs = Date.now() - batida.lastTickAt.getTime()
  const parado = ageMs > STALE_AFTER_MS

  // Três estados e não dois. «A passar mas a falhar» é o que aconteceu com o
  // Redis esgotado: o ciclo continuava vivo, de trinta em trinta segundos, e
  // não punha nada na fila. Um sinal de vida que só olhasse para a última
  // passagem tê-lo-ia dado por saudável durante dezoito horas.
  const status: SchedulerHealth['status'] = parado
    ? 'stale'
    : batida.lastError !== null
      ? 'failing'
      : 'ok'

  const corpo: SchedulerHealth = {
    status,
    ageSeconds: Math.round(ageMs / 1000),
    lastTickAt: batida.lastTickAt.toISOString(),
    lastHealthyTickAt: batida.lastHealthyTickAt?.toISOString() ?? null,
    lastEnqueueAt: batida.lastEnqueueAt?.toISOString() ?? null,
    lastError: batida.lastError,
    lastErrorAt: batida.lastErrorAt?.toISOString() ?? null,
  }

  // O código HTTP é a parte que interessa ao vigia: um workflow agendado
  // falha com um 503 e não precisa de saber ler JSON para dar o alarme.
  return NextResponse.json(corpo, { status: status === 'ok' ? 200 : 503 })
}
