import { maxSeverity, severityRank, type Severity } from '@jellycare/core'
import { schema } from '@jellycare/db'
import { and, desc, eq, gte, inArray, max, sql } from 'drizzle-orm'
import { getDb } from './db'

export interface SiteSummary {
  id: string
  organizationId: string
  label: string
  url: string
  hostname: string
  state: string
  verified: boolean
  /** Pior severidade entre os findings abertos. */
  worstSeverity: Severity | null
  openFindings: number
  /** Percentagem de amostras em cima nas últimas 24 horas. `null` sem dados. */
  uptime24h: number | null
  lastRunAt: Date | null
}

const OPEN_STATES = ['open', 'acknowledged'] as const

/** Sites das organizações a que o utilizador pertence, com o estado de saúde. */
export async function listSites(organizationIds: string[]): Promise<SiteSummary[]> {
  if (organizationIds.length === 0) return []
  const db = getDb()

  const sites = await db
    .select()
    .from(schema.sites)
    .where(inArray(schema.sites.organizationId, organizationIds))
    .orderBy(schema.sites.label)

  if (sites.length === 0) return []
  const siteIds = sites.map((site) => site.id)

  const [findingRows, verificationRows, uptimeRows, lastRuns] = await Promise.all([
    db
      .select({
        siteId: schema.findings.siteId,
        severity: schema.findings.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.findings)
      .where(
        and(
          inArray(schema.findings.siteId, siteIds),
          inArray(schema.findings.state, [...OPEN_STATES]),
        ),
      )
      .groupBy(schema.findings.siteId, schema.findings.severity),

    db
      .select({ siteId: schema.siteVerifications.siteId })
      .from(schema.siteVerifications)
      .where(
        and(
          inArray(schema.siteVerifications.siteId, siteIds),
          eq(schema.siteVerifications.state, 'verified'),
        ),
      ),

    db
      .select({
        siteId: schema.uptimeSamples.siteId,
        up: sql<number>`sum(case when ${schema.uptimeSamples.up} then 1 else 0 end)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.uptimeSamples)
      .where(
        and(
          inArray(schema.uptimeSamples.siteId, siteIds),
          gte(schema.uptimeSamples.observedAt, new Date(Date.now() - 24 * 3600_000)),
        ),
      )
      .groupBy(schema.uptimeSamples.siteId),

    db
      .select({
        siteId: schema.checkRuns.siteId,
        // `max()` do Drizzle e não um `sql` cru: o template cru devolve a data
        // como string e o tipo declarado seria uma mentira ao TypeScript, que
        // só rebenta em produção quando o site já tem execuções.
        lastRunAt: max(schema.checkRuns.startedAt),
      })
      .from(schema.checkRuns)
      .where(inArray(schema.checkRuns.siteId, siteIds))
      .groupBy(schema.checkRuns.siteId),
  ])

  const verified = new Set(verificationRows.map((row) => row.siteId))
  const lastRunBySite = new Map(lastRuns.map((row) => [row.siteId, row.lastRunAt]))
  const uptimeBySite = new Map(
    uptimeRows.map((row) => [row.siteId, row.total > 0 ? (row.up / row.total) * 100 : null]),
  )

  const severitiesBySite = new Map<string, Severity[]>()
  const countsBySite = new Map<string, number>()
  for (const row of findingRows) {
    const list = severitiesBySite.get(row.siteId) ?? []
    list.push(row.severity)
    severitiesBySite.set(row.siteId, list)
    countsBySite.set(row.siteId, (countsBySite.get(row.siteId) ?? 0) + row.count)
  }

  return sites.map((site) => {
    const severities = severitiesBySite.get(site.id) ?? []
    return {
      id: site.id,
      organizationId: site.organizationId,
      label: site.label,
      url: site.url,
      hostname: site.hostname,
      state: site.state,
      verified: verified.has(site.id),
      worstSeverity: severities.length > 0 ? maxSeverity(severities) : null,
      openFindings: countsBySite.get(site.id) ?? 0,
      uptime24h: uptimeBySite.get(site.id) ?? null,
      lastRunAt: lastRunBySite.get(site.id) ?? null,
    }
  })
}

export interface SiteReport {
  id: string
  periodYear: number
  periodMonth: number
  fileName: string
  generatedAt: Date
  sentAt: Date | null
  sentTo: string[]
  highlights: typeof schema.reports.$inferSelect['highlights']
}

export interface SiteDetail {
  site: typeof schema.sites.$inferSelect
  verified: boolean
  findings: (typeof schema.findings.$inferSelect)[]
  runs: (typeof schema.checkRuns.$inferSelect)[]
  checks: (typeof schema.checkConfigs.$inferSelect)[]
  forms: (typeof schema.forms.$inferSelect)[]
  reports: SiteReport[]
  /** Ligação a uma ferramenta externa, quando existe. Hoje só a WP Umbrella. */
  connector: typeof schema.connectors.$inferSelect | null
  /** Retrato do que está instalado, quando há conector que o saiba. */
  wpComponents: (typeof schema.wpComponents.$inferSelect)[]
}

export async function getSiteDetail(siteId: string): Promise<SiteDetail | null> {
  const db = getDb()

  const sites = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1)
  const site = sites[0]
  if (!site) return null

  const [findings, runs, checks, forms, verifications, reports, connectors, wpComponents] =
    await Promise.all([
    db
      .select()
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.siteId, siteId),
          inArray(schema.findings.state, [...OPEN_STATES]),
        ),
      )
      .limit(200),
    db
      .select()
      .from(schema.checkRuns)
      .where(eq(schema.checkRuns.siteId, siteId))
      .orderBy(desc(schema.checkRuns.startedAt))
      .limit(25),
    db.select().from(schema.checkConfigs).where(eq(schema.checkConfigs.siteId, siteId)),
    db.select().from(schema.forms).where(eq(schema.forms.siteId, siteId)),
    db
      .select({ id: schema.siteVerifications.id })
      .from(schema.siteVerifications)
      .where(
        and(
          eq(schema.siteVerifications.siteId, siteId),
          eq(schema.siteVerifications.state, 'verified'),
        ),
      )
      .limit(1),
    // O PDF fica de fora da consulta de propósito: são centenas de kilobytes
    // que a página não precisa de carregar para listar os relatórios.
    db
      .select({
        id: schema.reports.id,
        periodYear: schema.reports.periodYear,
        periodMonth: schema.reports.periodMonth,
        fileName: schema.reports.fileName,
        generatedAt: schema.reports.generatedAt,
        sentAt: schema.reports.sentAt,
        sentTo: schema.reports.sentTo,
        highlights: schema.reports.highlights,
      })
      .from(schema.reports)
      .where(eq(schema.reports.siteId, siteId))
      .orderBy(desc(schema.reports.periodYear), desc(schema.reports.periodMonth))
      .limit(12),
      db
        .select()
        .from(schema.connectors)
        .where(eq(schema.connectors.siteId, siteId))
        .limit(1),
      db
        .select()
        .from(schema.wpComponents)
        .where(eq(schema.wpComponents.siteId, siteId)),
    ])

  // Mais grave primeiro: quem abre a página de um site quer ver o que arde,
  // não a ordem em que a base de dados devolveu as linhas.
  findings.sort((a, b) => {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity)
    return bySeverity !== 0 ? bySeverity : b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
  })

  return {
    site,
    verified: verifications.length > 0,
    findings,
    runs,
    checks,
    forms,
    reports,
    connector: connectors[0] ?? null,
    wpComponents,
  }
}

export async function getPendingVerification(siteId: string) {
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.siteVerifications)
    .where(eq(schema.siteVerifications.siteId, siteId))
    .orderBy(desc(schema.siteVerifications.createdAt))
    .limit(1)
  return rows[0] ?? null
}

export interface UptimeWindow {
  /** Percentagem de amostras em cima. `null` quando não há amostras. */
  percentage: number | null
  samples: number
  /** Amostras em baixo, que é o que o cliente quer contar. */
  down: number
}

/**
 * Disponibilidade de um site numa janela de dias.
 *
 * Devolve também a contagem de amostras: uma percentagem construída sobre
 * meia dúzia de observações não significa o mesmo que uma construída sobre
 * milhares, e quem a lê tem direito a saber a diferença.
 */
export async function getUptime(siteId: string, days: number): Promise<UptimeWindow> {
  const rows = await getDb()
    .select({
      up: sql<number>`sum(case when ${schema.uptimeSamples.up} then 1 else 0 end)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.uptimeSamples)
    .where(
      and(
        eq(schema.uptimeSamples.siteId, siteId),
        gte(schema.uptimeSamples.observedAt, new Date(Date.now() - days * 24 * 3600_000)),
      ),
    )

  const row = rows[0]
  const total = row?.total ?? 0
  const up = row?.up ?? 0

  return {
    percentage: total > 0 ? (up / total) * 100 : null,
    samples: total,
    down: total - up,
  }
}
