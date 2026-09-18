import { getCheck, uptimeCheck } from '@jellycare/checks'
import {
  runCheck,
  type CheckContext,
  type CheckOutcome,
  type FindingNotification,
  type Site,
} from '@jellycare/core'
import { recordCheckRun, schema, type Database } from '@jellycare/db'
import {
  FORM_CHECKS,
  FORM_DELIVERY_CHECK,
  FORM_DISCOVERY_CHECK,
  FORM_TEST_CHECK,
} from '@jellycare/forms'
import type { Browser } from 'playwright'
import { and, desc, eq, gte, isNull, ne, or } from 'drizzle-orm'
import { runFormDelivery, runFormDiscovery, runFormTest } from './form-jobs.js'
import { applyRegionCorroboration, toUptimeSample } from './uptime-region.js'
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
  /** Só é chamado pelas rotinas que submetem formulários. */
  browser?: () => Promise<Browser>
  canaryDomain?: string
  /**
   * Chave da Safe Browsing da Google. É da plataforma, não do cliente, por
   * isso entra aqui e não na config de cada site — guardá-la por site seria
   * duplicar a mesma credencial por cada linha da tabela.
   */
  safeBrowsingApiKey?: string
}

/** O que o runner precisa de saber sobre uma verificação, venha ela de onde vier. */
interface CheckMeta {
  label: string
  access: 'public' | 'verified'
  confirmationsRequired: number
}

function metaFor(checkType: string): CheckMeta | null {
  const registered = getCheck(checkType)
  if (registered) {
    return {
      label: registered.label,
      access: registered.access,
      confirmationsRequired: registered.definition.confirmationsRequired,
    }
  }

  const form = FORM_CHECKS[checkType]
  if (form) {
    return {
      label: form.label,
      access: form.access,
      confirmationsRequired: form.confirmationsRequired,
    }
  }

  return null
}

/**
 * Quanto tempo uma amostra de outra região continua a valer como segunda
 * opinião. Mais curto do que isto e regiões com intervalos diferentes nunca se
 * cruzam; mais longo e estaríamos a comparar com o passado.
 */
const REGION_CORROBORATION_WINDOW_MS = 10 * 60_000

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
  const meta = metaFor(job.checkType)
  if (!meta) return { status: 'skipped', reason: `Check desconhecido: ${job.checkType}` }

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
  if (meta.access === 'verified') {
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
          `"${meta.label}" exige propriedade do domínio comprovada. ` +
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
  const region = deps.region ?? 'eu-west'
  const rawOutcome = await execute(deps, job.checkType, site, context, configRow.config, now)

  const outcome =
    job.checkType === uptimeCheck.type
      ? await settleUptime(deps, { outcome: rawOutcome, siteId: site.id, region, now })
      : rawOutcome

  const { runId, notifications } = await recordCheckRun(deps.db, {
    siteId: site.id,
    checkType: job.checkType,
    outcome,
    confirmationsRequired: meta.confirmationsRequired,
    region,
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

/**
 * Corre a verificação, seja ela agentless ou uma rotina de formulários.
 *
 * As rotinas de formulários são envolvidas no mesmo tratamento de erros das
 * outras: uma que rebente marca o run como falhado, e um run falhado nunca
 * resolve findings.
 */
async function execute(
  deps: RunnerDeps,
  checkType: string,
  site: Site,
  context: CheckContext,
  config: Record<string, unknown>,
  now: Date,
): Promise<CheckOutcome> {
  const registered = getCheck(checkType)
  if (registered) {
    const withPlatformConfig =
      checkType === 'reputation' && deps.safeBrowsingApiKey
        ? { ...config, safeBrowsingApiKey: deps.safeBrowsingApiKey }
        : config
    return runCheck(registered.definition, context, withPlatformConfig as never)
  }

  const formDeps = {
    db: deps.db,
    now,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.browser ? { browser: deps.browser } : {}),
  }

  const startedAt = Date.now()
  try {
    switch (checkType) {
      case FORM_DISCOVERY_CHECK:
        return await runFormDiscovery(formDeps, site, config)
      case FORM_TEST_CHECK:
        return await runFormTest(formDeps, site, {
          ...config,
          ...(deps.canaryDomain ? { canaryDomain: deps.canaryDomain } : {}),
        })
      case FORM_DELIVERY_CHECK:
        return await runFormDelivery(formDeps, site, config)
      default:
        throw new Error(`Rotina de formulários desconhecida: ${checkType}`)
    }
  } catch (error) {
    return {
      status: 'failed',
      findings: [],
      metrics: {},
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }
  }
}

interface SettleUptimeInput {
  outcome: CheckOutcome
  siteId: string
  region: string
  now: Date
}

/**
 * Grava a amostra de disponibilidade e confronta-a com as outras regiões.
 *
 * A amostra é escrita antes da corroboração de propósito: mesmo que a consulta
 * às outras regiões falhe, a observação desta região fica registada e conta
 * para o SLA.
 */
async function settleUptime(
  deps: RunnerDeps,
  input: SettleUptimeInput,
): Promise<CheckOutcome> {
  const { outcome, siteId, region, now } = input

  const sample = toUptimeSample(outcome, { region, observedAt: now })
  await deps.db.insert(schema.uptimeSamples).values({
    siteId,
    region: sample.region,
    observedAt: sample.observedAt,
    up: sample.up,
    statusCode: sample.statusCode,
    responseTimeMs: sample.responseTimeMs,
    failureReason: sample.failureReason,
  })

  if (!outcome.findings.some((finding) => finding.code === 'site_down')) return outcome

  const windowMs = REGION_CORROBORATION_WINDOW_MS
  const others = await deps.db
    .select({
      region: schema.uptimeSamples.region,
      up: schema.uptimeSamples.up,
      observedAt: schema.uptimeSamples.observedAt,
    })
    .from(schema.uptimeSamples)
    .where(
      and(
        eq(schema.uptimeSamples.siteId, siteId),
        ne(schema.uptimeSamples.region, region),
        gte(schema.uptimeSamples.observedAt, new Date(now.getTime() - windowMs)),
      ),
    )
    .orderBy(desc(schema.uptimeSamples.observedAt))
    .limit(50)

  const corroboration = applyRegionCorroboration(outcome.findings, others, {
    region,
    windowMs,
    now,
  })

  return {
    ...outcome,
    findings: corroboration.findings,
    metrics: {
      ...outcome.metrics,
      regionsConsulted: new Set(others.map((sample) => sample.region)).size,
      regionsReachable: corroboration.reachableFrom.length,
    },
  }
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
