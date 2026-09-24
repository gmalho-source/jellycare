import { notFound } from 'next/navigation'
import { Icone } from '@/components/icons'
import { Card, CardHeader, EmptyState, SeverityBadge, formatRelative } from '@/components/ui'
import { getSiteFindings } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { updateFindingState } from '../../../actions'

export const dynamic = 'force-dynamic'

const BOTAO = 'rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50'

export default async function ProblemasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteFindings(id)
  if (!detail) notFound()
  assertMembership(user, detail.organizationId)
  const manageable = canManage(user, detail.organizationId)

  return (
    <>
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
                            className={BOTAO}
                            title="Continua aberto e continua a contar; deixa de repetir o aviso enquanto não agravar"
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
                          className={BOTAO}
                          title="Sai da lista e deixa de notificar, mesmo que agrave — fica em «silenciados», aqui em baixo"
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

      {/* Os silenciados.

          Recolhidos porque não são trabalho pendente — mas visíveis, porque
          silenciar era a única ação da aplicação sem volta: o problema saía da
          lista e não havia ecrã nenhum onde o voltar a encontrar. Um
          `details` e não um painel com estado: não vale JavaScript no cliente
          para abrir e fechar uma gaveta. */}
      {detail.silenciados.length > 0 && (
        <details className="group rounded-2xl bg-white shadow-card">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <Icone
              nome="seta"
              className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-90"
            />
            <span className="text-sm font-semibold text-ink-900">
              Silenciados ({detail.silenciados.length})
            </span>
            <span className="flex-1" />
            <span className="hidden text-xs text-ink-400 sm:inline">
              não notificam, não contam e não entram no relatório
            </span>
          </summary>

          <ul className="divide-y divide-ink-100 border-t border-ink-100">
            {detail.silenciados.map((finding) => (
              <li key={finding.id} className="px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={finding.severity} />
                      <span className="font-medium text-ink-600">{finding.title}</span>
                    </div>

                    {finding.discriminator && (
                      <p className="mt-1 truncate text-xs text-ink-400">{finding.discriminator}</p>
                    )}

                    {/* Continua a ser observado por baixo: dizer há quanto
                        tempo foi visto pela última vez é a diferença entre
                        «isto já não acontece» e «isto acontece e nós é que
                        deixámos de olhar». */}
                    <p className="mt-2 text-xs text-ink-400">
                      Silenciado {formatRelative(finding.acknowledgedAt)} · visto pela última vez{' '}
                      {formatRelative(finding.lastSeenAt)}
                    </p>
                  </div>

                  {manageable && (
                    <form action={updateFindingState} className="shrink-0">
                      <input type="hidden" name="findingId" value={finding.id} />
                      <input type="hidden" name="state" value="open" />
                      <button
                        type="submit"
                        className={BOTAO}
                        title="Volta a contar, a notificar se agravar, e a poder ser dado como resolvido"
                      >
                        Reativar
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
