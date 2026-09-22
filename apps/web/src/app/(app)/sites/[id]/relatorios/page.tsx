import { notFound } from 'next/navigation'
import { latestReportRequest } from '@jellycare/db'
import { Card, CardHeader, EmptyState, formatRelative } from '@/components/ui'
import { getDb } from '@/lib/db'
import { getSiteDetail } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { ReportPanel } from '../report-panel'

export const dynamic = 'force-dynamic'

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

export default async function RelatoriosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()
  assertMembership(user, detail.site.organizationId)
  const manageable = canManage(user, detail.site.organizationId)
  const lastRequest = await latestReportRequest(getDb(), detail.site.id)

  return (
    <Card>
        <CardHeader
          title="Relatórios mensais"
          action={
            detail.reports.length > 0 ? (
              <span className="text-xs text-ink-400">Enviados ao cliente</span>
            ) : undefined
          }
        />
        {detail.reports.length === 0 ? (
          <EmptyState>
            Ainda não há relatórios. O primeiro é gerado no início do mês seguinte.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-ink-100">
            {detail.reports.map((report) => (
              <li key={report.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <a
                    href={`/api/reports/${report.id}`}
                    className="text-sm font-medium text-ink-900 hover:text-jelly-500"
                  >
                    {MONTHS[report.periodMonth - 1]} de {report.periodYear}
                  </a>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {report.highlights.summary[0] ?? ''}
                  </span>
                </div>
                <div className="shrink-0 pl-4 text-right">
                  <span className="block text-xs text-ink-400">
                    {report.sentAt
                      ? `Enviado ${formatRelative(report.sentAt)}`
                      : 'Por enviar'}
                  </span>
                  {report.highlights.uptimePercent !== null && (
                    <span className="block text-xs tabular-nums text-ink-600">
                      {report.highlights.uptimePercent.toFixed(2).replace('.', ',')}% disponível
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {manageable ? (
          <ReportPanel
            siteId={detail.site.id}
            configuredRecipients={detail.site.reportRecipients}
            lastRequest={lastRequest}
          />
        ) : null}
      </Card>
  )
}
