import { and, eq, isNull, lt } from 'drizzle-orm'
import type { Database } from './client.js'
import { claudeResolveRequests, sites } from './schema.js'

/** Uma reserva sem issue ao fim disto é de um pedido que morreu a meio. */
const RESERVA_ABANDONADA_MS = 5 * 60_000

export interface PedidoAoClaude {
  findingId: string
  repo: string
  issueNumber: number | null
  issueUrl: string | null
  createdAt: Date
}

export async function definirRepositorio(db: Database, siteId: string, repo: string | null): Promise<void> {
  await db.update(sites).set({ githubRepo: repo }).where(eq(sites.id, siteId))
}

/**
 * Reserva o pedido de um problema antes de abrir a issue.
 *
 * Devolve `null` se já houver um: dois cliques seguidos, ou duas pessoas ao
 * mesmo tempo, não abrem duas issues. Uma reserva que ficou sem issue há mais
 * de cinco minutos é de um pedido que morreu a meio, e não bloqueia o botão
 * para sempre.
 */
export async function reservarPedidoAoClaude(
  db: Database,
  pedido: { findingId: string; siteId: string; repo: string; requestedBy: string | null },
  now: Date = new Date(),
): Promise<string | null> {
  await db
    .delete(claudeResolveRequests)
    .where(
      and(
        eq(claudeResolveRequests.findingId, pedido.findingId),
        isNull(claudeResolveRequests.issueNumber),
        lt(claudeResolveRequests.createdAt, new Date(now.getTime() - RESERVA_ABANDONADA_MS)),
      ),
    )

  const [linha] = await db
    .insert(claudeResolveRequests)
    .values({ ...pedido, createdAt: now })
    .onConflictDoNothing({ target: claudeResolveRequests.findingId })
    .returning({ id: claudeResolveRequests.id })
  return linha?.id ?? null
}

export async function concluirPedidoAoClaude(
  db: Database,
  id: string,
  issue: { number: number; url: string },
): Promise<void> {
  await db
    .update(claudeResolveRequests)
    .set({ issueNumber: issue.number, issueUrl: issue.url })
    .where(eq(claudeResolveRequests.id, id))
}

/** O GitHub recusou: a reserva sai, e o botão volta. */
export async function anularPedidoAoClaude(db: Database, id: string): Promise<void> {
  await db.delete(claudeResolveRequests).where(eq(claudeResolveRequests.id, id))
}

export async function pedidosAoClaudeDoSite(db: Database, siteId: string): Promise<Map<string, PedidoAoClaude>> {
  const linhas = await db
    .select({
      findingId: claudeResolveRequests.findingId,
      repo: claudeResolveRequests.repo,
      issueNumber: claudeResolveRequests.issueNumber,
      issueUrl: claudeResolveRequests.issueUrl,
      createdAt: claudeResolveRequests.createdAt,
    })
    .from(claudeResolveRequests)
    .where(eq(claudeResolveRequests.siteId, siteId))
  return new Map(linhas.map((linha) => [linha.findingId, linha]))
}
