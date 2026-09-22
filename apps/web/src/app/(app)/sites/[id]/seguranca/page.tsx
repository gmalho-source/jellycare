import { notFound } from 'next/navigation'
import { Card, CardHeader, EmptyState, formatDateTime, formatRelative } from '@/components/ui'
import { checkMeta } from '@/lib/checks'
import { getSiteDetail } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { IntervalField } from '../interval-field'

export const dynamic = 'force-dynamic'

/**
 * O que vigiamos e o que correu.
 *
 * As duas coisas juntas de propósito: a pergunta «isto está a ser vigiado?»
 * e a pergunta «e correu?» fazem-se ao mesmo tempo, e separá-las obrigava a
 * saltar entre separadores para responder a uma só.
 */
export default async function VerificacoesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()
  assertMembership(user, detail.site.organizationId)
  const manageable = canManage(user, detail.site.organizationId)

  return (
    <>
      <Card>
        <CardHeader title="Verificações" />
          <ul className="divide-y divide-ink-100">
            {detail.checks.map((check) => {
              const registered = checkMeta(check.checkType)
              const blocked = !detail.verified && registered?.access === 'verified'
              return (
                <li
                  key={check.id}
                  data-check-row={check.checkType}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <span className="text-ink-900">{registered?.label ?? check.checkType}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
                      {blocked ? (
                        'Aguarda verificação do domínio'
                      ) : check.enabled ? (
                        <>
                          <span>A cada</span>
                          {manageable ? (
                            <IntervalField
                              checkConfigId={check.id}
                              intervalMinutes={check.intervalMinutes}
                            />
                          ) : (
                            <span>{formatInterval(check.intervalMinutes)}</span>
                          )}
                        </>
                      ) : (
                        'Desativada'
                      )}
                    </span>
                  </div>
                  <span className="shrink-0 pl-3 text-xs text-ink-400">
                    {check.lastRunAt ? formatRelative(check.lastRunAt) : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>

      <Card>
        <CardHeader title="Execuções recentes" />
        {detail.runs.length === 0 ? (
          <EmptyState>Ainda não correu nenhuma verificação.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink-100">
            {/* Cinco colunas de tabela não cabem em 390px: era isto que
                rebentava a página no telemóvel. A mesma grelha empilha em
                duas linhas no pequeno e alinha nas cinco colunas a partir de
                `sm`. */}
            {detail.runs.map((run) => {
              const motivo = run.error ?? run.warnings.join(' · ')

              return (
                <li
                  key={run.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[minmax(7rem,1fr)_9.5rem_minmax(0,2fr)_5rem_7rem] sm:gap-4 sm:px-5 sm:py-2.5"
                >
                  <span className="min-w-0 truncate text-ink-900">
                    {checkMeta(run.checkType)?.label ?? run.checkType}
                  </span>

                  <span className="justify-self-end sm:justify-self-start">
                    <span
                      className={
                        run.status !== 'ok'
                          ? 'sev-high whitespace-nowrap rounded-full px-2 py-0.5 text-xs'
                          : run.warnings.length > 0
                            ? 'sev-medium whitespace-nowrap rounded-full px-2 py-0.5 text-xs'
                            : 'sev-ok whitespace-nowrap rounded-full px-2 py-0.5 text-xs'
                      }
                    >
                      {run.status !== 'ok'
                        ? 'Falhou'
                        : run.warnings.length > 0
                          ? 'Cobertura reduzida'
                          : 'Concluída'}
                    </span>
                  </span>

                  {/* Os avisos só aparecem aqui: dizem respeito à plataforma e
                      não ao site, por isso nunca chegam ao portal do cliente
                      nem ao relatório mensal.

                      Limitado a três linhas. Um erro de API traz a resposta
                      inteira do fornecedor — a do Safe Browsing ocupava meio
                      ecrã de telemóvel e empurrava tudo o resto para baixo. O
                      texto completo fica no `title` e nos registos. */}
                  <p
                    title={motivo}
                    className={`col-span-2 line-clamp-3 min-w-0 break-words text-xs text-ink-400 sm:col-span-1 ${
                      // Sem motivo não há nada a mostrar no telemóvel, mas a
                      // célula tem de continuar a existir no grande: uma
                      // coluna a menos numa linha desalinha a grelha inteira.
                      motivo ? '' : 'hidden sm:block'
                    }`}
                  >
                    {motivo}
                  </p>

                  <span className="col-span-2 flex items-center gap-1.5 text-xs text-ink-400 sm:contents">
                    <span className="tabular-nums sm:text-right">{run.durationMs} ms</span>
                    <span aria-hidden className="sm:hidden">
                      ·
                    </span>
                    <span className="sm:text-right">{formatDateTime(run.startedAt)}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`
  const days = Math.round(minutes / (60 * 24))
  return days === 1 ? 'dia' : days === 7 ? 'semana' : `${days} dias`
}
