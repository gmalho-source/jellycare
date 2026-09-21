import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import type { Database } from './client.js'
import { reportRequests } from './schema.js'

/**
 * Pedidos manuais de relatório.
 *
 * O painel deixa o pedido, o worker executa-o. A separação não é burocracia:
 * gerar o PDF precisa de um browser, e o dashboard não tem nenhum.
 */

export type ReportRequest = typeof reportRequests.$inferSelect

export interface RequestedReport {
  request: ReportRequest
  /** Falso quando já havia um pedido a decorrer para este site. */
  created: boolean
}

/**
 * Pede o relatório de um site.
 *
 * Se já houver um pedido por concluir, devolve esse em vez de criar outro: o
 * índice parcial garante-o na base de dados, e não só na lógica, porque dois
 * cliques seguidos não podem mandar dois emails ao cliente.
 */
export async function requestReport(
  db: Database,
  options: { siteId: string; requestedBy?: string; recipients?: string[] },
): Promise<RequestedReport> {
  const inserted = await db
    .insert(reportRequests)
    .values({
      siteId: options.siteId,
      ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
      recipients: options.recipients ?? [],
    })
    .onConflictDoNothing()
    .returning()

  if (inserted[0]) return { request: inserted[0], created: true }

  const pending = await db
    .select()
    .from(reportRequests)
    .where(and(eq(reportRequests.siteId, options.siteId), isNull(reportRequests.completedAt)))
    .limit(1)

  // O pedido pode ter-se concluído entre o insert e esta leitura. Nesse caso
  // não há nada pendente e tentar de novo é o comportamento certo.
  if (!pending[0]) return requestReport(db, options)

  return { request: pending[0], created: false }
}

/** Quanto tempo um pedido pode estar reclamado antes de se assumir abandonado. */
const STALE_CLAIM_MINUTES = 10

/**
 * Reclama o próximo pedido por executar.
 *
 * Usa o construtor de queries e não SQL cru de propósito: o `db.execute`
 * devolve as colunas como estão na base de dados — `site_id` e não `siteId` —
 * e o worker ficava com o identificador do site a `undefined`, gerando
 * relatório nenhum sem se queixar de nada.
 *
 * Um pedido reclamado há muito e nunca concluído é reclamado outra vez: quer
 * dizer que o worker morreu a meio, e sem isto ficava a bloquear o site para
 * sempre — o índice parcial não deixaria criar outro.
 */
export async function claimNextReportRequest(db: Database): Promise<ReportRequest | null> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000)

  return db.transaction(async (tx) => {
    // `for update skip locked` porque pode haver mais do que um worker: dois a
    // reclamar ao mesmo tempo não podem levar o mesmo pedido, senão o cliente
    // recebe o relatório duas vezes.
    const candidates = await tx
      .select({ id: reportRequests.id })
      .from(reportRequests)
      .where(
        and(
          isNull(reportRequests.completedAt),
          or(isNull(reportRequests.startedAt), lt(reportRequests.startedAt, staleBefore)),
        ),
      )
      .orderBy(reportRequests.requestedAt)
      .limit(1)
      .for('update', { skipLocked: true })

    const candidate = candidates[0]
    if (!candidate) return null

    const claimed = await tx
      .update(reportRequests)
      .set({ startedAt: new Date() })
      .where(eq(reportRequests.id, candidate.id))
      .returning()

    return claimed[0] ?? null
  })
}

export async function completeReportRequest(
  db: Database,
  id: string,
  outcome: { periodYear?: number; periodMonth?: number; sentTo?: string[]; error?: string },
): Promise<void> {
  await db
    .update(reportRequests)
    .set({
      completedAt: new Date(),
      ...(outcome.periodYear !== undefined ? { periodYear: outcome.periodYear } : {}),
      ...(outcome.periodMonth !== undefined ? { periodMonth: outcome.periodMonth } : {}),
      sentTo: outcome.sentTo ?? [],
      error: outcome.error ?? null,
    })
    .where(eq(reportRequests.id, id))
}

/** O último pedido de um site, para o painel mostrar em que ponto está. */
export async function latestReportRequest(
  db: Database,
  siteId: string,
): Promise<ReportRequest | null> {
  const rows = await db
    .select()
    .from(reportRequests)
    .where(eq(reportRequests.siteId, siteId))
    .orderBy(desc(reportRequests.requestedAt))
    .limit(1)

  return rows[0] ?? null
}
