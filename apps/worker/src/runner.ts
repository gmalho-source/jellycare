import { getCheck } from '@jellycare/checks'
import { runCheck, type CheckContext, type FindingNotification, type Site } from '@jellycare/core'
import { recordCheckRun, schema, type Database } from '@jellycare/db'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { Notifier } from './channels.js'
import {
  deliverableTargets,
  renderNotification,
  type NotificationTarget,
} from './notifications.js'

export interface CheckJobData {
  siteId: string
  checkType: string
}

export interface RunnerDeps {
  db: Database
  notifier: Notifier
  fetch?: typeof globalThis.fetch
  region?: string
  now?: () => Date
}

export type RunOutcome =
  | { status: 'completed'; runId: string; findings: number; notified: number }
  | { status: 'skipped'; reason: string }

/**
 * Executa um check agendado do princípio ao fim: corre, persiste e notifica.
 *
 * A ordem não é acidental. A persistência vem antes da notificação porque um
 * problema registado e não comunicado ainda aparece no dashboard e no relatório
 * mensal; um problema comunicado e não registado desaparece e volta a alertar
 * no run seguinte.
 */
export async function executeCheckJob(
  deps: RunnerDeps,
  job: CheckJobData,
): Promise<RunOutcome> {
  const now = deps.now?.() ?? new Date()
  const registered = getCheck(job.checkType)
  if (!registered) return { status: 'skipped', reason: `Check desconhecido: ${job.checkType}` }

  const siteRows = await deps.db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, job.siteId))
    .limit(1)

  const siteRow = siteRows[0]
  if (!siteRow) return { status: 'skipped', reason: 'Site não encontrado' }
  if (siteRow.state !== 'active') {
    return { status: 'skipped', reason: `Site em estado ${siteRow.state}` }
  }

  // A regra que mantém a plataforma do lado certo da lei: sem prova de
  // propriedade do domínio, só corre o que qualquer visitante faria.
  if (registered.access === 'verified') {
    const verified = await deps.db
      .select({ id: schema.siteVerifications.id })
      .from(schema.siteVerifications)
      .where(
        and(
          eq(schema.siteVerifications.siteId, job.siteId),
          eq(schema.siteVerifications.state, 'verified'),
        ),
      )
      .limit(1)

    if (verified.length === 0) {
      return {
        status: 'skipped',
        reason:
          `"${registered.label}" exige propriedade do domínio comprovada. ` +
          'Conclua a verificação por DNS TXT ou ficheiro para o ativar.',
      }
    }
  }

  const configRows = await deps.db
    .select()
    .from(schema.checkConfigs)
    .where(
      and(
        eq(schema.checkConfigs.siteId, job.siteId),
        eq(schema.checkConfigs.checkType, job.checkType),
      ),
    )
    .limit(1)

  const configRow = configRows[0]
  if (!configRow) return { status: 'skipped', reason: 'Verificação não configurada para este site' }
  if (!configRow.enabled) return { status: 'skipped', reason: 'Verificação desativada' }

  const site: Site = {
    id: siteRow.id,
    organizationId: siteRow.organizationId,
    url: siteRow.url,
    hostname: siteRow.hostname,
    label: siteRow.label,
  }

  const context: CheckContext = {
    site,
    now,
    fetch: deps.fetch ?? globalThis.fetch,
  }

  const startedAt = new Date()
  const outcome = await runCheck(
    registered.definition,
    context,
    configRow.config as never,
  )

  const { runId, notifications } = await recordCheckRun(deps.db, {
    siteId: site.id,
    checkType: job.checkType,
    outcome,
    confirmationsRequired: registered.definition.confirmationsRequired,
    region: deps.region ?? 'eu-west',
    startedAt,
    now,
  })

  const notified = await dispatchNotifications(deps, {
    notifications,
    site,
    maintenanceWindows: siteRow.maintenanceWindows,
    now,
  })

  return { status: 'completed', runId, findings: outcome.findings.length, notified }
}

interface DispatchInput {
  notifications: FindingNotification[]
  site: Site
  maintenanceWindows: { start: string; end: string }[]
  now: Date
}

async function dispatchNotifications(
  deps: RunnerDeps,
  input: DispatchInput,
): Promise<number> {
  if (input.notifications.length === 0) return 0

  const targetRows = await deps.db
    .select()
    .from(schema.notificationTargets)
    .where(
      and(
        eq(schema.notificationTargets.organizationId, input.site.organizationId),
        // Canais da organização inteira, mais os dedicados a este site.
        or(
          isNull(schema.notificationTargets.siteId),
          eq(schema.notificationTargets.siteId, input.site.id),
        ),
      ),
    )

  const targets: NotificationTarget[] = targetRows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    siteId: row.siteId,
    channel: row.channel,
    destination: row.destination,
    minSeverity: row.minSeverity,
    enabled: row.enabled,
  }))

  let delivered = 0

  for (const notification of input.notifications) {
    const chosen = deliverableTargets(notification, targets, {
      organizationId: input.site.organizationId,
      siteId: input.site.id,
      siteLabel: input.site.label,
      maintenanceWindows: input.maintenanceWindows,
      now: input.now,
    })

    if (chosen.length === 0) continue

    const rendered = renderNotification(
      notification,
      { siteLabel: input.site.label },
      input.site.url,
    )

    const findingRows = await deps.db
      .select({ id: schema.findings.id })
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.siteId, input.site.id),
          eq(schema.findings.fingerprint, notification.fingerprint),
        ),
      )
      .limit(1)
    const findingId = findingRows[0]?.id ?? null

    for (const target of chosen) {
      const result = await deps.notifier.send(target, rendered)
      if (result.succeeded) delivered++

      // O registo de entrega é o que permite responder a "porque é que não
      // fomos avisados?" com factos em vez de suposições.
      await deps.db.insert(schema.notificationDeliveries).values({
        targetId: target.id,
        findingId,
        kind: notification.kind,
        succeeded: result.succeeded,
        error: result.error ?? null,
      })
    }
  }

  return delivered
}
