import { maxSeverity, severityRank, type Severity } from '@jellycare/core'
import { schema } from '@jellycare/db'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
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
        lastRunAt: sql<Date>`max(${schema.checkRuns.startedAt})`,
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

export interface SiteDetail {
  site: typeof schema.sites.$inferSelect
  verified: boolean
  findings: (typeof schema.findings.$inferSelect)[]
  runs: (typeof schema.checkRuns.$inferSelect)[]
  checks: (typeof schema.checkConfigs.$inferSelect)[]
  forms: (typeof schema.forms.$inferSelect)[]
}

export async function getSiteDetail(siteId: string): Promise<SiteDetail | null> {
  const db = getDb()

  const sites = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1)
  const site = sites[0]
  if (!site) return null

  const [findings, runs, checks, forms, verifications] = await Promise.all([
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
  ])

  // Mais grave primeiro: quem abre a página de um site quer ver o que arde,
  // não a ordem em que a base de dados devolveu as linhas.
  findings.sort((a, b) => {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity)
    return bySeverity !== 0 ? bySeverity : b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
  })

  return { site, verified: verifications.length > 0, findings, runs, checks, forms }
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
