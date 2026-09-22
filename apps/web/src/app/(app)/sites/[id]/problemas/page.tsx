import { notFound } from 'next/navigation'
import { Card, CardHeader, EmptyState, SeverityBadge, formatRelative } from '@/components/ui'
import { getSiteFindings } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { updateFindingState } from '../../../actions'

export const dynamic = 'force-dynamic'

export default async function ProblemasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteFindings(id)
  if (!detail) notFound()
  assertMembership(user, detail.organizationId)
  const manageable = canManage(user, detail.organizationId)

  return (
    <Card>
      <CardHeader
        title={`Problemas abertos (${detail.findings.length})`}
        action={
          detail.findings.length > 0 ? (
            <span className="text-xs text-ink-400">Mais graves primeiro</span>
          ) : undefined
        }
      />
      {detail.findings.length === 0 ? (
        <EmptyState>Nenhum problema aberto neste site.</EmptyState>
      ) : (
        <ul className="divide-y divide-ink-100">
          {detail.findings.map((finding) => (
            <li key={finding.id} className="px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="font-medium text-ink-900">{finding.title}</span>
                    {finding.state === 'acknowledged' && (
                      <span className="text-xs text-ink-400">reconhecido</span>
                    )}
                  </div>

                  {finding.discriminator && (
                    <p className="mt-1 truncate text-xs text-ink-400">{finding.discriminator}</p>
                  )}
                  {finding.detail && (
                    <p className="mt-2 text-sm text-ink-600">{finding.detail}</p>
                  )}

                  <p className="mt-2 text-xs text-ink-400">
                    Detetado {formatRelative(finding.firstSeenAt)} · visto pela última vez{' '}
                    {formatRelative(finding.lastSeenAt)} · {finding.occurrences}{' '}
                    {finding.occurrences === 1 ? 'observação' : 'observações'}
                  </p>
                </div>

                {manageable && (
                  <div className="flex shrink-0 gap-2">
                    {finding.state !== 'acknowledged' && (
                      <form action={updateFindingState}>
                        <input type="hidden" name="findingId" value={finding.id} />
                        <input type="hidden" name="state" value="acknowledged" />
                        <button
                          type="submit"
                          className="rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
                        >
                          Reconhecer
                        </button>
                      </form>
                    )}
                    <form action={updateFindingState}>
                      <input type="hidden" name="findingId" value={finding.id} />
                      <input type="hidden" name="state" value="ignored" />
                      <button
                        type="submit"
                        className="rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
                        title="Deixa de notificar e de aparecer, mesmo que se agrave"
                      >
                        Silenciar
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
