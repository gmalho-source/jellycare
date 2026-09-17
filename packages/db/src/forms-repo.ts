import { and, eq } from 'drizzle-orm'
import type { Database } from './client.js'
import { formRuns } from './schema.js'

export interface CanaryDelivery {
  token: string
  receivedAt: Date
  latencyMs: number
  spf: string | null
  dkim: string | null
  dmarc: string | null
  landedInSpam: boolean | null
}

export type DeliveryOutcome =
  | { status: 'recorded'; formRunId: string; siteId: string }
  /** O token não corresponde a nenhuma submissão nossa. */
  | { status: 'unknown_token' }
  /** Já tínhamos registado a entrega desta submissão. */
  | { status: 'already_recorded'; formRunId: string }

/**
 * Regista a chegada da notificação de um formulário.
 *
 * É idempotente de propósito: os fornecedores de inbox repetem entregas quando
 * não recebem 2xx a tempo, e a segunda entrega do mesmo email não pode
 * sobrepor-se à primeira — a latência medida na primeira é a verdadeira.
 */
export async function recordCanaryDelivery(
  db: Database,
  delivery: CanaryDelivery,
): Promise<DeliveryOutcome> {
  const rows = await db
    .select({
      id: formRuns.id,
      siteId: formRuns.siteId,
      emailReceived: formRuns.emailReceived,
    })
    .from(formRuns)
    .where(eq(formRuns.canaryToken, delivery.token))
    .limit(1)

  const run = rows[0]
  if (!run) return { status: 'unknown_token' }
  if (run.emailReceived) return { status: 'already_recorded', formRunId: run.id }

  const updated = await db
    .update(formRuns)
    .set({
      emailReceived: true,
      emailReceivedAt: delivery.receivedAt,
      deliveryLatencyMs: delivery.latencyMs,
      spf: delivery.spf,
      dkim: delivery.dkim,
      dmarc: delivery.dmarc,
      landedInSpam: delivery.landedInSpam,
    })
    // A condição repete-se aqui para fechar a corrida entre duas entregas
    // simultâneas do mesmo email: só uma delas escreve.
    .where(and(eq(formRuns.id, run.id), eq(formRuns.emailReceived, false)))
    .returning({ id: formRuns.id })

  if (updated.length === 0) return { status: 'already_recorded', formRunId: run.id }

  return { status: 'recorded', formRunId: run.id, siteId: run.siteId }
}
