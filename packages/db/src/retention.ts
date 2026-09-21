import { and, eq, isNotNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from './client.js'
import {
  checkRuns,
  findings,
  formRuns,
  loginTokens,
  notificationDeliveries,
  reports,
  sessions,
  uptimeSamples,
} from './schema.js'

/**
 * Apagar o que já não é preciso.
 *
 * A plataforma acumula o retrato de segurança de dezenas de sites de
 * terceiros: que páginas existem, que ficheiros estão expostos, que
 * formulários recebem pedidos e o que respondem. Guardar isso indefinidamente
 * não serve ninguém e transforma uma fuga eventual num problema muito maior do
 * que precisava de ser. A política está em `docs/riscos.md` e é esta que a
 * executa.
 *
 * Nada do que o cliente ainda precisa é tocado: um problema por resolver fica,
 * por muito antigo que seja, e os relatórios só saem depois de dois anos.
 */

export interface RetentionPolicy {
  /** Execuções, amostras e submissões. Por omissão 90 dias. */
  rawDays: number
  /** Relatórios e problemas já resolvidos. Por omissão 24 meses. */
  aggregateMonths: number
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  rawDays: 90,
  aggregateMonths: 24,
}

export interface RetentionOutcome {
  checkRuns: number
  uptimeSamples: number
  formRuns: number
  notificationDeliveries: number
  resolvedFindings: number
  reports: number
  loginTokens: number
  sessions: number
}

function monthsBefore(now: Date, months: number): Date {
  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
  return cutoff
}

/**
 * Quantas linhas o `delete` apagou.
 *
 * O resultado do postgres.js é um array com uma propriedade `count` — é um
 * array vazio e ao mesmo tempo sabe quantas linhas tocou. Perguntar pelo
 * comprimento primeiro devolvia sempre zero, e uma limpeza que diz não ter
 * apagado nada é indistinguível de uma limpeza que não correu.
 */
async function deleteCount(promise: Promise<unknown>): Promise<number> {
  const result = (await promise) as { count?: number; rowCount?: number } | unknown[]
  const record = result as { count?: number; rowCount?: number }
  if (typeof record.count === 'number') return record.count
  if (typeof record.rowCount === 'number') return record.rowCount
  return Array.isArray(result) ? result.length : 0
}

export async function applyRetention(
  db: Database,
  policy: RetentionPolicy = DEFAULT_RETENTION,
  now: Date = new Date(),
): Promise<RetentionOutcome> {
  const rawCutoff = new Date(now.getTime() - policy.rawDays * 24 * 3600_000)
  const aggregateCutoff = monthsBefore(now, policy.aggregateMonths)

  // Ordem deliberada: primeiro o volumoso e sem dependências, depois o que
  // outras linhas referenciam. As entregas de notificação apontam para
  // findings, por isso saem antes deles.
  const deletedCheckRuns = await deleteCount(
    db.delete(checkRuns).where(lt(checkRuns.startedAt, rawCutoff)),
  )

  const deletedSamples = await deleteCount(
    db.delete(uptimeSamples).where(lt(uptimeSamples.observedAt, rawCutoff)),
  )

  // As submissões guardam o endereço canário e o que o site respondeu. Noventa
  // dias de histórico chegam para o teste de entrega saber se um formulário já
  // entregou alguma vez — com um teste por dia são noventa observações.
  const deletedFormRuns = await deleteCount(
    db.delete(formRuns).where(lt(formRuns.startedAt, rawCutoff)),
  )

  const deletedDeliveries = await deleteCount(
    db.delete(notificationDeliveries).where(lt(notificationDeliveries.sentAt, rawCutoff)),
  )

  // Só os resolvidos, e só depois do prazo dos agregados. Um problema em
  // aberto nunca é apagado por idade: continua a ser verdade.
  const deletedFindings = await deleteCount(
    db
      .delete(findings)
      .where(
        and(
          eq(findings.state, 'resolved'),
          isNotNull(findings.resolvedAt),
          lt(findings.resolvedAt, aggregateCutoff),
        ),
      ),
  )

  const deletedReports = await deleteCount(
    db.delete(reports).where(lt(reports.generatedAt, aggregateCutoff)),
  )

  // Autenticação: tokens gastos ou expirados e sessões caducadas não têm
  // prazo de retenção nenhum — deixam de servir no instante em que expiram.
  const deletedTokens = await deleteCount(
    db
      .delete(loginTokens)
      .where(or(lt(loginTokens.expiresAt, now), isNotNull(loginTokens.consumedAt))),
  )

  const deletedSessions = await deleteCount(
    db.delete(sessions).where(lt(sessions.expiresAt, now)),
  )

  return {
    checkRuns: deletedCheckRuns,
    uptimeSamples: deletedSamples,
    formRuns: deletedFormRuns,
    notificationDeliveries: deletedDeliveries,
    resolvedFindings: deletedFindings,
    reports: deletedReports,
    loginTokens: deletedTokens,
    sessions: deletedSessions,
  }
}

/**
 * Screenshots.
 *
 * A política prevê trinta dias, e não há nada a apagar: a coluna
 * `form_runs.screenshot_key` existe mas nunca é escrita, porque as capturas
 * do submissor não são guardadas em lado nenhum. Se um dia passarem a ser,
 * o prazo é aqui e o teste que o garante vive ao lado deste comentário.
 */
export async function countStoredScreenshots(db: Database): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(formRuns)
    .where(isNotNull(formRuns.screenshotKey))

  return rows[0]?.n ?? 0
}
