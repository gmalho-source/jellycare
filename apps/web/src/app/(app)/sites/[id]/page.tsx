import { CHECK_REGISTRY, buildChallenge } from '@jellycare/checks'
import { notFound } from 'next/navigation'
import {
  Card,
  CardHeader,
  EmptyState,
  SeverityBadge,
  formatDateTime,
  formatRelative,
} from '@/components/ui'
import { getPendingVerification, getSiteDetail } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { updateFindingState } from '../../actions'
import { VerificationPanel } from './verification-panel'

export const dynamic = 'force-dynamic'

const FORM_KIND_LABEL: Record<string, string> = {
  contact: 'Contacto',
  search: 'Pesquisa',
  login: 'Autenticação',
  registration: 'Registo',
  commerce: 'Compra',
  newsletter: 'Newsletter',
  unknown: 'Por classificar',
}

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()

  assertMembership(user, detail.site.organizationId)
  const manageable = canManage(user, detail.site.organizationId)

  const verification = detail.verified ? null : await getPendingVerification(id)
  const challenge =
    verification && !detail.verified
      ? buildChallenge(verification.method, detail.site.hostname, verification.token)
      : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{detail.site.label}</h1>
        <a
          href={detail.site.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-block text-sm text-ink-600 hover:text-jelly-500"
        >
          {detail.site.url}
        </a>
      </div>

      {challenge && (
        <VerificationPanel siteId={detail.site.id} challenge={challenge} canManage={manageable} />
      )}

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
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={finding.severity} />
                      <span className="font-medium text-ink-900">{finding.title}</span>
                      {finding.state === 'acknowledged' && (
                        <span className="text-xs text-ink-400">reconhecido</span>
                      )}
                    </div>

                    {finding.discriminator && (
                      <p className="mt-1 truncate text-xs text-ink-400">
                        {finding.discriminator}
                      </p>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Verificações" />
          <ul className="divide-y divide-ink-100">
            {detail.checks.map((check) => {
              const registered = CHECK_REGISTRY[check.checkType]
              const blocked = !detail.verified && registered?.access === 'verified'
              return (
                <li
                  key={check.id}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <div>
                    <span className="text-ink-900">{registered?.label ?? check.checkType}</span>
                    <span className="mt-0.5 block text-xs text-ink-400">
                      {blocked
                        ? 'Aguarda verificação do domínio'
                        : check.enabled
                          ? `A cada ${formatInterval(check.intervalMinutes)}`
                          : 'Desativada'}
                    </span>
                  </div>
                  <span className="text-xs text-ink-400">
                    {check.lastRunAt ? formatRelative(check.lastRunAt) : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Formulários" />
          {detail.forms.length === 0 ? (
            <EmptyState>
              Nenhum formulário descoberto ainda. São detetados durante a análise do site.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-ink-100">
              {detail.forms.map((form) => (
                <li key={form.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-900">{form.label}</span>
                    <span className="text-xs text-ink-400">
                      {form.excluded ? 'Não submetido' : form.enabled ? 'Em teste' : 'Desativado'}
                    </span>
                  </div>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {form.pageUrl}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Execuções recentes" />
        {detail.runs.length === 0 ? (
          <EmptyState>Ainda não correu nenhuma verificação.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-ink-100">
              {detail.runs.map((run) => (
                <tr key={run.id}>
                  <td className="px-5 py-2.5 text-ink-900">
                    {CHECK_REGISTRY[run.checkType]?.label ?? run.checkType}
                  </td>
                  <td className="px-5 py-2.5">
                    <span
                      className={
                        run.status === 'ok'
                          ? 'sev-ok rounded-full px-2 py-0.5 text-xs'
                          : 'sev-high rounded-full px-2 py-0.5 text-xs'
                      }
                    >
                      {run.status === 'ok' ? 'Concluída' : 'Falhou'}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-xs text-ink-400">{run.error ?? ''}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-xs text-ink-400">
                    {run.durationMs} ms
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs text-ink-400">
                    {formatDateTime(run.startedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`
  const days = Math.round(minutes / (60 * 24))
  return days === 1 ? 'dia' : days === 7 ? 'semana' : `${days} dias`
}
