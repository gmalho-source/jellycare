import { notFound } from 'next/navigation'
import { Card, CardHeader } from '@/components/ui'
import { ResponseTimeChart } from '@/components/response-time-chart'
import { getResponseTimes, getSiteHeader } from '@/lib/queries'
import { assertMembership, requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function DesempenhoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const header = await getSiteHeader(id)
  if (!header) notFound()
  assertMembership(user, header.site.organizationId)

  const dias = await getResponseTimes(id)

  return (
    <Card>
      <CardHeader
        title="Tempo de resposta"
        action={<span className="text-xs text-ink-400">Últimos 30 dias</span>}
      />
      <ResponseTimeChart days={dias} />
    </Card>
  )
}
