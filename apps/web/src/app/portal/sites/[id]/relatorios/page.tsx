import { notFound } from 'next/navigation'
import { Card, CardHeader, EmptyState, formatDateTime, nomeDoMes } from '@/components/ui'
import { getSiteDetail } from '@/lib/queries'
import { assertMembership, requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function PortalRelatoriosPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()
  assertMembership(user, detail.site.organizationId)

  return (
    <Card>
      <CardHeader title="Relatórios mensais" />
      {detail.reports.length === 0 ? (
        <EmptyState>
          O primeiro relatório é enviado no início do mês seguinte ao arranque.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-ink-100">
          {detail.reports.map((report) => (
            <li
              key={report.id}
              className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
            >
              <div>
                <a
                  href={`/api/reports/${report.id}`}
                  className="font-medium text-ink-900 underline underline-offset-2"
                >
                  {nomeDoMes(report.periodMonth)} de {report.periodYear}
                </a>
                <p className="text-xs text-ink-400">
                  Gerado a {formatDateTime(report.generatedAt)}
                </p>
              </div>
              <span className="text-xs text-ink-400">PDF</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
