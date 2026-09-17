import type {
  CheckOutcome,
  FindingNotification,
  StoredFinding,
} from '@jellycare/core'
import { reconcileFindings } from '@jellycare/core'
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from './client.js'
import { checkRuns, findings } from './schema.js'

type FindingRow = typeof findings.$inferSelect

function toStoredFinding(row: FindingRow): StoredFinding {
  const finding: StoredFinding = {
    id: row.id,
    siteId: row.siteId,
    checkType: row.checkType,
    fingerprint: row.fingerprint,
    code: row.code,
    severity: row.severity,
    state: row.state,
    title: row.title,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    occurrences: row.occurrences,
  }
  if (row.discriminator !== null) finding.discriminator = row.discriminator
  if (row.detail !== null) finding.detail = row.detail
  if (row.evidence !== null) finding.evidence = row.evidence
  if (row.resolvedAt !== null) finding.resolvedAt = row.resolvedAt
  return finding
}

export interface RecordRunInput {
  siteId: string
  checkType: string
  outcome: CheckOutcome
  confirmationsRequired?: number
  region?: string
  startedAt: Date
  now?: Date
}

export interface RecordRunResult {
  runId: string
  notifications: FindingNotification[]
}

/**
 * Persiste um run e reconcilia os seus findings numa única transação.
 *
 * Tudo ou nada: se a escrita dos findings falhar a meio, o run também não fica
 * registado. Caso contrário ficaria um run bem-sucedido cujos problemas
 * ninguém registou, e o run seguinte trataria esses problemas como novos.
 */
export async function recordCheckRun(
  db: Database,
  input: RecordRunInput,
): Promise<RecordRunResult> {
  const { siteId, checkType, outcome, startedAt } = input
  const now = input.now ?? new Date()

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(checkRuns)
      .values({
        siteId,
        checkType,
        status: outcome.status,
        region: input.region ?? 'eu-west',
        startedAt,
        durationMs: outcome.durationMs,
        error: outcome.error ?? null,
        metrics: outcome.metrics,
      })
      .returning({ id: checkRuns.id })

    const runId = inserted[0]?.id
    if (!runId) throw new Error('Falha ao registar check run')

    const existingRows = await tx
      .select()
      .from(findings)
      .where(and(eq(findings.siteId, siteId), eq(findings.checkType, checkType)))

    const reconciliation = reconcileFindings({
      siteId,
      checkType,
      observed: outcome.findings,
      existing: existingRows.map(toStoredFinding),
      confirmationsRequired: input.confirmationsRequired ?? 1,
      runSucceeded: outcome.status === 'ok',
      now,
    })

    if (reconciliation.creates.length > 0) {
      await tx
        .insert(findings)
        .values(
          reconciliation.creates.map((finding) => ({
            siteId: finding.siteId,
            checkType: finding.checkType,
            fingerprint: finding.fingerprint,
            code: finding.code,
            discriminator: finding.discriminator ?? null,
            severity: finding.severity,
            state: finding.state,
            title: finding.title,
            detail: finding.detail ?? null,
            evidence: finding.evidence ?? null,
            firstSeenAt: finding.firstSeenAt,
            lastSeenAt: finding.lastSeenAt,
            occurrences: finding.occurrences,
          })),
        )
        // Dois workers podem correr o mesmo check em paralelo. O índice único
        // resolve a corrida; sem isto o segundo rebentava com violação de
        // constraint e perdia o run inteiro.
        .onConflictDoUpdate({
          target: [findings.siteId, findings.fingerprint],
          set: { lastSeenAt: now },
        })
    }

    for (const update of reconciliation.updates) {
      await tx
        .update(findings)
        .set({
          ...(update.changes.severity !== undefined && { severity: update.changes.severity }),
          ...(update.changes.state !== undefined && { state: update.changes.state }),
          ...(update.changes.title !== undefined && { title: update.changes.title }),
          ...(update.changes.detail !== undefined && { detail: update.changes.detail }),
          ...(update.changes.evidence !== undefined && { evidence: update.changes.evidence }),
          ...(update.changes.lastSeenAt !== undefined && { lastSeenAt: update.changes.lastSeenAt }),
          ...(update.changes.occurrences !== undefined && {
            occurrences: update.changes.occurrences,
          }),
          // `resolvedAt: undefined` numa reabertura significa limpar a data.
          ...('resolvedAt' in update.changes && { resolvedAt: update.changes.resolvedAt ?? null }),
        })
        .where(eq(findings.id, update.id))
    }

    return { runId, notifications: reconciliation.notifications }
  })
}

export async function openFindingsForSite(
  db: Database,
  siteId: string,
): Promise<StoredFinding[]> {
  const rows = await db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.siteId, siteId),
        inArray(findings.state, ['open', 'acknowledged']),
      ),
    )
  return rows.map(toStoredFinding)
}
