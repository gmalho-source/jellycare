import { notFound } from 'next/navigation'
import { schema } from '@jellycare/db'
import { desc, eq } from 'drizzle-orm'
import { Card, CardHeader } from '@/components/ui'
import { WordPressMetrics } from '@/components/site-dashboard'
import { getSiteDashboard } from '@/lib/dashboard'
import { getDb } from '@/lib/db'
import { getSiteDetail } from '@/lib/queries'
import { listUmbrellaProjects } from '@/lib/umbrella'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { AutoUpdatePanel } from '../auto-update-panel'
import { WordPressPanel } from '../wordpress-panel'

export const dynamic = 'force-dynamic'

export default async function WordPressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()
  assertMembership(user, detail.site.organizationId)
  const manageable = canManage(user, detail.site.organizationId)

  const umbrella = manageable
    ? await listUmbrellaProjects()
    : { projects: [], unavailable: undefined }
  const dashboard = detail.verified ? await getSiteDashboard(id) : null

  const atualizacoes = detail.connector
    ? await getDb()
        .select()
        .from(schema.wpUpdates)
        .where(eq(schema.wpUpdates.siteId, detail.site.id))
        .orderBy(desc(schema.wpUpdates.orderedAt))
        .limit(10)
    : []

  return (
    <>
      {dashboard?.wordpress ? (
        <WordPressMetrics snapshot={dashboard.wordpress} interno />
      ) : null}

      <Card>
        <CardHeader title="Ligação" />
        <WordPressPanel
          siteId={detail.site.id}
          linked={
            detail.connector
              ? {
                  externalId: detail.connector.externalId,
                  externalName: detail.connector.externalName,
                }
              : null
          }
          lastSyncAt={detail.connector?.lastSyncAt ?? null}
          lastError={detail.connector?.lastError ?? null}
          options={umbrella.projects.map((project) => ({
            id: project.id,
            name: project.name,
            baseUrl: project.baseUrl,
            connectivity: project.connectivity,
          }))}
          {...(umbrella.unavailable ? { unavailable: umbrella.unavailable } : {})}
          components={detail.wpComponents.map((component) => ({
            kind: component.kind,
            key: component.key,
            name: component.name,
            version: component.version,
            latestVersion: component.latestVersion,
            active: component.active,
          }))}
          canManage={manageable}
        />
      </Card>

      {detail.connector ? (
        <Card>
          <CardHeader title="Atualizações automáticas" />
          <AutoUpdatePanel
            siteId={detail.site.id}
            enabled={detail.site.autoUpdate}
            hasWindow={
              detail.site.maintenanceWindows.length > 0 ||
              detail.site.maintenanceSchedule !== null
            }
            history={atualizacoes.map((registo) => ({
              id: registo.id,
              name: registo.name,
              kind: registo.kind,
              fromVersion: registo.fromVersion,
              toVersion: registo.toVersion,
              status: registo.status,
              vulnerable: registo.vulnerable,
              orderedAt: registo.orderedAt,
            }))}
            canManage={manageable}
          />
        </Card>
      ) : null}
    </>
  )
}
