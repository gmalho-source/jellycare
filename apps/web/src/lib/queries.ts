import { maxSeverity, severityRank, type Severity } from '@jellycare/core'
import { schema } from '@jellycare/db'
import { and, desc, eq, gte, inArray, max, sql } from 'drizzle-orm'
import { cache } from 'react'
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
  /** Tem ligação a uma ferramenta de manutenção. Decide as secções do menu. */
  hasConnector: boolean
}

const OPEN_STATES = ['open', 'acknowledged'] as const

/**
 * Os sites de uma ou mais organizações, com o estado de cada um.
 *
 * Memorizado dentro do pedido com uma chave estável: a coluna de navegação e
 * a lista pedem o mesmo em ramos diferentes da árvore, e `cache` distingue
 * argumentos por identidade — um array novo em cada chamada nunca acertaria
 * no que já foi lido.
 */
export function listSites(organizationIds: string[]): Promise<SiteSummary[]> {
  return lerSites([...organizationIds].sort().join(','))
}

/** Primeiro o que precisa de atenção: quem abre o painel de manhã quer ver o que arde. */
export function ordenarPorGravidade(sites: readonly SiteSummary[]): SiteSummary[] {
  return [...sites].sort((a, b) => {
    if (a.worstSeverity && !b.worstSeverity) return -1
    if (!a.worstSeverity && b.worstSeverity) return 1
    return a.label.localeCompare(b.label, 'pt-PT')
  })
}

const lerSites = cache(async (chave: string): Promise<SiteSummary[]> => {
  const organizationIds = chave.length === 0 ? [] : chave.split(',')
  if (organizationIds.length === 0) return []
  const db = getDb()

  const sites = await db
    .select()
    .from(schema.sites)
    .where(inArray(schema.sites.organizationId, organizationIds))
    .orderBy(schema.sites.label)

  if (sites.length === 0) return []
  const siteIds = sites.map((site) => site.id)

  const [findingRows, verificationRows, uptimeRows, lastRuns, connectorRows] = await Promise.all([
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

    db
      .select({ siteId: schema.connectors.siteId })
      .from(schema.connectors)
      .where(inArray(schema.connectors.siteId, siteIds)),
  ])

  const verified = new Set(verificationRows.map((row) => row.siteId))
  const comConector = new Set(connectorRows.map((row) => row.siteId))
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
      hasConnector: comConector.has(site.id),
    }
  })
})

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

/**
 * O mínimo para desenhar o cabeçalho e a navegação.
 *
 * Existe porque a página do site passou a ter secções: o `layout` corre em
 * todas elas, e fazê-lo carregar o detalhe inteiro punha as oito consultas do
 * `getSiteDetail` em cada visita a cada separador — exatamente o custo que a
 * divisão em secções serve para evitar.
 */
export interface SiteHeader {
  site: typeof schema.sites.$inferSelect
  verified: boolean
  hasConnector: boolean
  openFindings: number
  /** A pior severidade em aberto, ou nulo quando não há nada. */
  worstSeverity: Severity | null
}

export const getSiteHeader = cache(async (siteId: string): Promise<SiteHeader | null> => {
  const db = getDb()

  const sites = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1)
  const site = sites[0]
  if (!site) return null

  const [verifications, connectors, abertos] = await Promise.all([
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
    db
      .select({ id: schema.connectors.id })
      .from(schema.connectors)
      .where(eq(schema.connectors.siteId, siteId))
      .limit(1),
    db
      .select({ severity: schema.findings.severity })
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.siteId, siteId),
          inArray(schema.findings.state, [...OPEN_STATES]),
        ),
      )
      .limit(200),
  ])

  return {
    site,
    verified: verifications.length > 0,
    hasConnector: connectors.length > 0,
    openFindings: abertos.length,
    // A pior de facto, e não uma escolhida à mão: o cabeçalho é o elemento
    // mais visível da página, e dizer «médio» sobre um problema crítico seria
    // mentir no sítio onde mais se olha.
    worstSeverity: maxSeverity(abertos.map((linha) => linha.severity)),
  }
})

/**
 * Tempo de resposta dia a dia.
 *
 * Os dados estão guardados em cada observação de disponibilidade desde o
 * primeiro dia; o que nunca existiu foi onde os mostrar.
 *
 * Um dia sem observações fica com `average` a nulo e não a zero — a mesma
 * regra da faixa de disponibilidade. Zero milissegundos é uma afirmação
 * absurda, e desenhá-la como se fosse um dia bom seria pior do que deixar a
 * linha interrompida.
 */
export interface DailyResponseTime {
  day: string
  average: number | null
  slowest: number | null
  samples: number
}

export async function getResponseTimes(
  siteId: string,
  days = 30,
): Promise<DailyResponseTime[]> {
  const db = getDb()
  const end = new Date()
  const start = new Date(end.getTime() - days * 24 * 3600_000)

  const amostras = await db
    .select({
      observedAt: schema.uptimeSamples.observedAt,
      responseTimeMs: schema.uptimeSamples.responseTimeMs,
    })
    .from(schema.uptimeSamples)
    .where(
      and(
        eq(schema.uptimeSamples.siteId, siteId),
        gte(schema.uptimeSamples.observedAt, start),
      ),
    )

  const baldes = new Map<string, number[]>()
  for (let dia = new Date(start); dia <= end; dia.setUTCDate(dia.getUTCDate() + 1)) {
    baldes.set(dia.toISOString().slice(0, 10), [])
  }

  for (const amostra of amostras) {
    // Uma observação falhada não tem tempo de resposta, e contá-la como zero
    // baixava a média com o valor mais rápido possível justamente quando o
    // site estava em baixo.
    if (amostra.responseTimeMs === null) continue
    const balde = baldes.get(amostra.observedAt.toISOString().slice(0, 10))
    if (balde) balde.push(amostra.responseTimeMs)
  }

  return [...baldes.entries()].map(([day, valores]) => ({
    day,
    average:
      valores.length > 0
        ? Math.round(valores.reduce((total, valor) => total + valor, 0) / valores.length)
        : null,
    slowest: valores.length > 0 ? Math.round(Math.max(...valores)) : null,
    samples: valores.length,
  }))
}

export interface PageSpeedPoint {
  /** Quando a medição foi feita. */
  measuredAt: Date
  /** 0–100. */
  score: number
  lcpMs: number | null
  cls: number | null
  tbtMs: number | null
}

export interface PageSpeedHistory {
  points: PageSpeedPoint[]
  /** A última medição, ou nulo quando ainda não houve nenhuma. */
  latest: PageSpeedPoint | null
  /**
   * Diferença face à medição mais antiga do período. Nulo com menos de duas
   * medições: uma seta de tendência desenhada sobre um único ponto é uma
   * afirmação sobre dados que não existem.
   */
  trend: number | null
}

/**
 * Histórico da pontuação de velocidade.
 *
 * Lê as métricas dos runs em vez de uma tabela própria: a PageSpeed corre uma
 * vez por dia e o índice `(site, tipo, início)` já serve exatamente esta
 * pergunta. Uma tabela nova seria a mesma informação escrita duas vezes.
 */
export async function getPageSpeedHistory(
  siteId: string,
  checkType = 'page_speed',
  days = 30,
): Promise<PageSpeedHistory> {
  const db = getDb()
  const start = new Date(Date.now() - days * 24 * 3600_000)

  const runs = await db
    .select({
      startedAt: schema.checkRuns.startedAt,
      metrics: schema.checkRuns.metrics,
    })
    .from(schema.checkRuns)
    .where(
      and(
        eq(schema.checkRuns.siteId, siteId),
        eq(schema.checkRuns.checkType, checkType),
        eq(schema.checkRuns.status, 'ok'),
        gte(schema.checkRuns.startedAt, start),
      ),
    )
    .orderBy(schema.checkRuns.startedAt)

  const numero = (valor: number | undefined): number | null =>
    typeof valor === 'number' && Number.isFinite(valor) ? valor : null

  const points: PageSpeedPoint[] = []
  for (const run of runs) {
    const score = numero(run.metrics.performanceScore)
    // Um run sem pontuação não entra: o gráfico mostra medições, e uma linha
    // que cai a zero num dia em que a Google não respondeu leria como uma
    // regressão do site.
    if (score === null) continue
    points.push({
      measuredAt: run.startedAt,
      score,
      lcpMs: numero(run.metrics.lcpMs),
      cls: numero(run.metrics.cls),
      tbtMs: numero(run.metrics.tbtMs),
    })
  }

  const latest = points.at(-1) ?? null
  const primeiro = points[0]

  return {
    points,
    latest,
    trend: latest && primeiro && points.length > 1 ? latest.score - primeiro.score : null,
  }
}

/** Só os problemas, para a secção que só mostra problemas. */
export async function getSiteFindings(
  siteId: string,
): Promise<{ organizationId: string; findings: (typeof schema.findings.$inferSelect)[] } | null> {
  const db = getDb()

  const sites = await db
    .select({ organizationId: schema.sites.organizationId })
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId))
    .limit(1)
  const site = sites[0]
  if (!site) return null

  const findings = await db
    .select()
    .from(schema.findings)
    .where(
      and(eq(schema.findings.siteId, siteId), inArray(schema.findings.state, [...OPEN_STATES])),
    )
    .limit(200)

  findings.sort((a, b) => {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity)
    return bySeverity !== 0 ? bySeverity : b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
  })

  return { organizationId: site.organizationId, findings }
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
