import { notFound } from 'next/navigation'
import { Card, EmptyState } from '@/components/ui'
import { BackupMetrics } from '@/components/site-dashboard'
import { getSiteDashboard } from '@/lib/dashboard'
import { getSiteHeader } from '@/lib/queries'
import { assertMembership, requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function CopiasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const header = await getSiteHeader(id)
  if (!header) notFound()
  assertMembership(user, header.site.organizationId)

  const dashboard = header.verified ? await getSiteDashboard(id) : null

  if (!dashboard?.backups) {
    return (
      <Card>
        <EmptyState>
          Ainda não há registo de cópias de segurança para este site. Aparecem aqui depois da
          primeira recolha.
        </EmptyState>
      </Card>
    )
  }

  return <BackupMetrics snapshot={dashboard.backups} />
}
