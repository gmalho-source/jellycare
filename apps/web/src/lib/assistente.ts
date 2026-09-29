import type { ContextoDoProblema, TurnoDaConversa } from '@jellycare/assistant'
import { isInAnyMaintenanceWindow, schema } from '@jellycare/db'
import { and, asc, desc, eq } from 'drizzle-orm'
import { getDb } from './db'
import { canManage, getCurrentUser } from './session'

export interface ProblemaParaAssistente {
  organizationId: string
  siteId: string
  contexto: ContextoDoProblema
}

/** Quantas execuções do mesmo check entram no contexto. */
const EXECUCOES = 5

/**
 * Tudo o que o assistente sabe sobre um problema, lido da base de dados.
 *
 * Montado a cada pedido e nunca guardado com a conversa: um problema que
 * agravou, ou que entretanto foi resolvido, tem de entrar na conversa como
 * está agora e não como estava quando alguém abriu o painel.
 *
 * Devolve também a organização, porque quem chama tem de confirmar a pertença
 * antes de mandar seja o que for para fora — e o identificador do problema
 * vem de um URL.
 */
export async function lerProblemaParaAssistente(
  findingId: string,
  agora: Date,
): Promise<ProblemaParaAssistente | null> {
  const db = getDb()

  const linhas = await db
    .select({ finding: schema.findings, site: schema.sites })
    .from(schema.findings)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.findings.siteId))
    .where(eq(schema.findings.id, findingId))
    .limit(1)

  const linha = linhas[0]
  if (!linha) return null

  const [execucoes, componentes, conector, verificacao] = await Promise.all([
    db
      .select()
      .from(schema.checkRuns)
      .where(
        and(
          eq(schema.checkRuns.siteId, linha.site.id),
          eq(schema.checkRuns.checkType, linha.finding.checkType),
        ),
      )
      .orderBy(desc(schema.checkRuns.startedAt))
      .limit(EXECUCOES),
    db
      .select()
      .from(schema.wpComponents)
      .where(eq(schema.wpComponents.siteId, linha.site.id))
      .orderBy(asc(schema.wpComponents.name)),
    db
      .select()
      .from(schema.connectors)
      .where(eq(schema.connectors.siteId, linha.site.id))
      .limit(1),
    db
      .select({ state: schema.siteVerifications.state })
      .from(schema.siteVerifications)
      .where(
        and(
          eq(schema.siteVerifications.siteId, linha.site.id),
          eq(schema.siteVerifications.state, 'verified'),
        ),
      )
      .limit(1),
  ])

  return {
    organizationId: linha.site.organizationId,
    siteId: linha.site.id,
    contexto: {
      site: {
        label: linha.site.label,
        url: linha.site.url,
        hostname: linha.site.hostname,
        verified: verificacao.length > 0,
        state: linha.site.state,
      },
      problema: {
        code: linha.finding.code,
        checkType: linha.finding.checkType,
        title: linha.finding.title,
        detail: linha.finding.detail,
        severity: linha.finding.severity,
        state: linha.finding.state,
        evidence: linha.finding.evidence,
        firstSeenAt: linha.finding.firstSeenAt,
        lastSeenAt: linha.finding.lastSeenAt,
        occurrences: linha.finding.occurrences,
      },
      execucoes: execucoes.map((execucao) => ({
        startedAt: execucao.startedAt,
        status: execucao.status,
        durationMs: execucao.durationMs,
        error: execucao.error,
        warnings: execucao.warnings,
        metrics: execucao.metrics,
      })),
      // Sem conector não há inventário que valha: as linhas que lá estejam são
      // o retrato de uma ligação que já não existe.
      wordpress: conector[0]
        ? {
            recolhidoEm: conector[0].lastSyncAt,
            componentes: componentes.map((componente) => ({
              kind: componente.kind,
              name: componente.name,
              version: componente.version,
              latestVersion: componente.latestVersion,
              active: componente.active,
            })),
          }
        : null,
      emManutencao: isInAnyMaintenanceWindow(
        linha.site.maintenanceWindows,
        linha.site.maintenanceSchedule,
        agora,
      ),
    },
  }
}

/**
 * A conversa desta pessoa sobre este problema, criada se ainda não existir.
 *
 * Uma por pessoa: partilhada, o histórico de um colega entrava no contexto do
 * modelo sem ninguém contar com isso, e duas pessoas a escrever ao mesmo
 * tempo intercalavam turnos.
 */
export async function abrirConversa(findingId: string, userId: string): Promise<string> {
  const db = getDb()

  const existente = await db
    .select({ id: schema.assistantThreads.id })
    .from(schema.assistantThreads)
    .where(
      and(
        eq(schema.assistantThreads.findingId, findingId),
        eq(schema.assistantThreads.openedBy, userId),
      ),
    )
    .limit(1)

  if (existente[0]) return existente[0].id

  const [criada] = await db
    .insert(schema.assistantThreads)
    .values({ findingId, openedBy: userId })
    .returning({ id: schema.assistantThreads.id })

  return criada!.id
}

/** Os turnos de uma conversa, do mais antigo para o mais recente. */
export async function lerConversa(threadId: string): Promise<TurnoDaConversa[]> {
  const linhas = await getDb()
    .select({
      role: schema.assistantMessages.role,
      content: schema.assistantMessages.content,
    })
    .from(schema.assistantMessages)
    .where(eq(schema.assistantMessages.threadId, threadId))
    .orderBy(asc(schema.assistantMessages.createdAt))

  return linhas.map((linha) => ({ role: linha.role, content: linha.content }))
}

/**
 * Quem pede, e o problema, se quem pede gere a organização dele.
 *
 * `null` quando não há sessão; `'nao_encontrado'` tanto quando o problema não
 * existe como quando existe e não é de quem pede — confirmar a existência de
 * um problema de outro cliente já é informação a mais. É a verificação de
 * gestão e não a de pertença: um cliente pertence à organização e passaria na
 * segunda.
 */
export async function problemaParaQuemGere(
  findingId: string,
  agora: Date,
): Promise<
  | null
  | 'nao_encontrado'
  | { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; problema: ProblemaParaAssistente }
> {
  const user = await getCurrentUser()
  if (!user) return null
  const problema = await lerProblemaParaAssistente(findingId, agora)
  if (!problema || !canManage(user, problema.organizationId)) return 'nao_encontrado'
  return { user, problema }
}
