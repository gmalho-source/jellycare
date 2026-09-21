import { schema } from '@jellycare/db'
import { buildReport, type ReportData } from '@jellycare/reports/data'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { getDb } from './db'

/**
 * As métricas de um site, a 30 dias.
 *
 * Usa o mesmo motor do relatório mensal, sobre uma janela deslizante em vez
 * de um mês de calendário. Não é economia de código: se o painel e o PDF que
 * vai para o cliente calculassem a disponibilidade cada um à sua maneira,
 * mais cedo ou mais tarde discordavam — e a discussão acontecia à frente do
 * cliente, que é o pior sítio para a ter.
 */

export const DASHBOARD_WINDOW_DAYS = 30

export interface WordPressSnapshot {
  projectName: string | null
  lastSyncAt: Date | null
  lastError: string | null
  plugins: number
  themes: number
  updatesPending: number
  /** Vulnerabilidades em aberto, por severidade. */
  vulnerabilities: { critical: number; high: number; medium: number; low: number }
  /** O que precisa de atenção primeiro, já ordenado. */
  outdated: { name: string; kind: string; from: string | null; to: string | null }[]
}

export interface DashboardData {
  report: ReportData
  /** Disponibilidade dia a dia, para a série temporal. */
  daily: { day: string; up: number; total: number; percent: number | null }[]
  /** Dias até o certificado expirar, da execução mais recente do check de TLS. */
  certDaysRemaining: number | null
  wordpress: WordPressSnapshot | null
}

/** O código dos findings que o conector da WP Umbrella produz. */
const WP_VULNERABILITY_CODE = 'wp_known_vulnerability'
const OPEN_STATES = ['open', 'acknowledged'] as const

export async function getSiteDashboard(siteId: string): Promise<DashboardData | null> {
  const db = getDb()

  const sites = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1)
  const site = sites[0]
  if (!site) return null

  const end = new Date()
  const start = new Date(end.getTime() - DASHBOARD_WINDOW_DAYS * 24 * 3600_000)

  const [organizations, samples, findings, formRuns, checkRuns, tlsRuns] = await Promise.all([
    db
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, site.organizationId))
      .limit(1),
    db
      .select()
      .from(schema.uptimeSamples)
      .where(
        and(eq(schema.uptimeSamples.siteId, siteId), gte(schema.uptimeSamples.observedAt, start)),
      ),
    // Os findings não são limitados à janela: um problema aberto há meses
    // continua aberto hoje, e escondê-lo por ser antigo seria mentir sobre o
    // estado do site. O motor é que decide o que conta como aberto no fim do
    // período e o que foi aberto ou resolvido dentro dele.
    db.select().from(schema.findings).where(eq(schema.findings.siteId, siteId)).limit(500),
    db
      .select({
        formLabel: schema.forms.label,
        startedAt: schema.formRuns.startedAt,
        submitted: schema.formRuns.submitted,
        emailReceived: schema.formRuns.emailReceived,
        deliveryLatencyMs: schema.formRuns.deliveryLatencyMs,
        landedInSpam: schema.formRuns.landedInSpam,
      })
      .from(schema.formRuns)
      .innerJoin(schema.forms, eq(schema.forms.id, schema.formRuns.formId))
      .where(and(eq(schema.formRuns.siteId, siteId), gte(schema.formRuns.startedAt, start))),
    db
      .select({
        checkType: schema.checkRuns.checkType,
        status: schema.checkRuns.status,
        startedAt: schema.checkRuns.startedAt,
      })
      .from(schema.checkRuns)
      .where(and(eq(schema.checkRuns.siteId, siteId), gte(schema.checkRuns.startedAt, start))),
    db
      .select({ metrics: schema.checkRuns.metrics })
      .from(schema.checkRuns)
      .where(and(eq(schema.checkRuns.siteId, siteId), eq(schema.checkRuns.checkType, 'tls')))
      .orderBy(desc(schema.checkRuns.startedAt))
      .limit(1),
  ])

  const report = buildReport({
    organizationName: organizations[0]?.name ?? 'Jellycare',
    site: { label: site.label, url: site.url, hostname: site.hostname },
    period: { start, end, label: `últimos ${DASHBOARD_WINDOW_DAYS} dias`, year: end.getUTCFullYear(), month: end.getUTCMonth() + 1 },
    uptimeSamples: samples.map((sample) => ({
      observedAt: sample.observedAt,
      up: sample.up,
      failureReason: sample.failureReason,
      responseTimeMs: sample.responseTimeMs,
    })),
    findings: findings.map((finding) => ({
      checkType: finding.checkType,
      code: finding.code,
      discriminator: finding.discriminator,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      state: finding.state,
      firstSeenAt: finding.firstSeenAt,
      lastSeenAt: finding.lastSeenAt,
      resolvedAt: finding.resolvedAt,
    })),
    formRuns,
    checkRuns: checkRuns.map((run) => ({
      checkType: run.checkType,
      status: run.status as 'ok' | 'failed',
      startedAt: run.startedAt,
    })),
    slaTarget: site.slaTarget,
  })

  const certMetric = tlsRuns[0]?.metrics as Record<string, number> | undefined
  const certDaysRemaining =
    typeof certMetric?.certDaysRemaining === 'number' ? certMetric.certDaysRemaining : null

  return {
    report,
    daily: dailyUptime(samples, start, end),
    certDaysRemaining,
    wordpress: await wordpressSnapshot(siteId, findings),
  }
}

/**
 * Disponibilidade dia a dia.
 *
 * Um dia sem observações fica com `percent` a nulo e não a zero. Zero
 * significa "esteve em baixo o dia todo" e é a afirmação mais grave que este
 * painel pode fazer — não se diz isso por não termos olhado.
 */
export function dailyUptime(
  samples: readonly { observedAt: Date; up: boolean }[],
  start: Date,
  end: Date,
): DashboardData['daily'] {
  const buckets = new Map<string, { up: number; total: number }>()

  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    buckets.set(day.toISOString().slice(0, 10), { up: 0, total: 0 })
  }

  for (const sample of samples) {
    const key = sample.observedAt.toISOString().slice(0, 10)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.total++
    if (sample.up) bucket.up++
  }

  return [...buckets.entries()].map(([day, { up, total }]) => ({
    day,
    up,
    total,
    percent: total > 0 ? (up / total) * 100 : null,
  }))
}

/**
 * O retrato WordPress, quando o site está ligado à WP Umbrella.
 *
 * Lê o inventário guardado pela recolha diária e não a API ao vivo. Um painel
 * que chamasse um serviço de terceiros a cada visita ficava refém do tempo de
 * resposta e do limite de pedidos deles — e o inventário de um site não muda
 * entre duas visitas à mesma página. O que se mostra é quando foi recolhido,
 * para ninguém confundir dados de ontem com dados de agora.
 */
async function wordpressSnapshot(
  siteId: string,
  findings: readonly { code: string; severity: string; state: string }[],
): Promise<WordPressSnapshot | null> {
  const db = getDb()

  const links = await db
    .select()
    .from(schema.connectors)
    .where(and(eq(schema.connectors.siteId, siteId), eq(schema.connectors.type, 'wp_umbrella')))
    .limit(1)

  const link = links[0]
  if (!link) return null

  const components = await db
    .select()
    .from(schema.wpComponents)
    .where(eq(schema.wpComponents.siteId, siteId))

  const outdated = components
    .filter((component) => component.latestVersion !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
    .map((component) => ({
      name: component.name,
      kind: component.kind,
      from: component.version,
      to: component.latestVersion,
    }))

  const vulnerabilities = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const finding of findings) {
    if (finding.code !== WP_VULNERABILITY_CODE) continue
    if (!OPEN_STATES.includes(finding.state as (typeof OPEN_STATES)[number])) continue
    if (finding.severity in vulnerabilities) {
      vulnerabilities[finding.severity as keyof typeof vulnerabilities]++
    }
  }

  return {
    projectName: link.externalName,
    lastSyncAt: link.lastSyncAt,
    lastError: link.lastError,
    plugins: components.filter((component) => component.kind === 'plugin').length,
    themes: components.filter((component) => component.kind === 'theme').length,
    updatesPending: outdated.length,
    vulnerabilities,
    outdated,
  }
}
