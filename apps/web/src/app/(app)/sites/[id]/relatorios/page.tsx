import { notFound } from 'next/navigation'
import { destinatariosDoRelatorio, latestReportRequest } from '@jellycare/db'
import { REPORT_SECTIONS, monthToDate, previousMonth } from '@jellycare/reports/data'
import { Card, CardHeader, EmptyState, formatRelative, nomeDoMes } from '@/components/ui'
import { getDb } from '@/lib/db'
import { getSiteDetail } from '@/lib/queries'
import { lerNotasDoRelatorio } from '@/lib/relatorio-conteudo'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { ReportPanel } from '../report-panel'
import { ModulosDoRelatorio, NotasDaEquipa } from './conteudo'

export const dynamic = 'force-dynamic'

export default async function RelatoriosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()
  assertMembership(user, detail.site.organizationId)
  const manageable = canManage(user, detail.site.organizationId)
  // Só para os rótulos e para desligar a opção sem dados. Quem decide o
  // período é o worker, com as mesmas funções.
  const agora = new Date()
  const mesAnterior = previousMonth(agora, 'Europe/Lisbon')
  const mesEmCurso = monthToDate(agora, 'Europe/Lisbon')

  const [lastRequest, notas, destinatarios] = await Promise.all([
    latestReportRequest(getDb(), detail.site.id),
    manageable ? lerNotasDoRelatorio(detail.site.id) : null,
    // Os do site e os contactos da organização que recebem relatórios.
    destinatariosDoRelatorio(getDb(), detail.site.id),
  ])

  return (
    <>
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
                    className="text-sm font-medium text-ink-900 hover:underline"
                  >
                    {nomeDoMes(report.periodMonth)} de {report.periodYear}
                  </a>
                  {report.partial ? (
                    <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-[0.6875rem] font-medium text-ink-600">
                      Provisório
                    </span>
                  ) : null}
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
            configuredRecipients={destinatarios}
            lastRequest={lastRequest}
            mesAnterior={mesAnterior.label}
            mesEmCurso={mesEmCurso.label}
            mesAnteriorSemDados={detail.site.createdAt.getTime() >= mesAnterior.end.getTime()}
          />
        ) : null}
      </Card>

      {/* Configuração do que o cliente recebe. Só para quem gere: as notas
          são a voz da equipa, e um cliente a ver as do mês seguinte antes de
          serem enviadas não é o que ele contratou. */}
      {manageable && notas ? (
        <>
          <Card>
            <CardHeader
              title="O que entra no relatório"
              action={<span className="text-xs text-ink-400">Vale a partir do próximo</span>}
            />
            <ModulosDoRelatorio
              siteId={detail.site.id}
              modulos={REPORT_SECTIONS}
              excluidas={detail.site.reportExcludedSections}
              temWordPress={detail.connector !== null}
            />
          </Card>

          <Card>
            <CardHeader title="Notas da equipa" />
            <NotasDaEquipa
              siteId={detail.site.id}
              ativas={notas.ativas}
              anteriores={notas.anteriores}
            />
          </Card>
        </>
      ) : null}
    </>
  )
}
