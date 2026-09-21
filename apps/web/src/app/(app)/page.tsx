import Link from 'next/link'
import { HealthBadge, formatRelative, formatUptime } from '@/components/ui'
import { listSites } from '@/lib/queries'
import { requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const STATE_LABEL: Record<string, string> = {
  onboarding: 'Por verificar',
  active: 'Ativo',
  paused: 'Em pausa',
  archived: 'Arquivado',
}

export default async function SitesPage() {
  const user = await requireUser()
  const sites = await listSites(user.memberships.map((membership) => membership.organizationId))

  // Primeiro o que precisa de atenção. Quem abre o painel de manhã quer ver o
  // que arde, não a lista por ordem alfabética.
  const sorted = [...sites].sort((a, b) => {
    if (a.worstSeverity && !b.worstSeverity) return -1
    if (!a.worstSeverity && b.worstSeverity) return 1
    return a.label.localeCompare(b.label, 'pt-PT')
  })

  const comProblemas = sorted.filter((site) => site.worstSeverity !== null).length

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sites</h1>
          <p className="mt-1 text-sm text-ink-600">
            {sites.length === 0
              ? 'Ainda não há sites em monitorização.'
              : comProblemas === 0
                ? `${sites.length} ${sites.length === 1 ? 'site' : 'sites'} em monitorização, nenhum com problemas abertos.`
                : `${comProblemas} de ${sites.length} ${sites.length === 1 ? 'site' : 'sites'} com problemas abertos.`}
          </p>
        </div>

        <Link
          href="/sites/new"
          className="rounded-lg bg-jelly-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-jelly-600"
        >
          Adicionar site
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-16 text-center">
          <p className="text-sm text-ink-600">
            Adicione o primeiro site para começar a monitorizar.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-5 py-2.5 font-medium">Site</th>
                <th className="px-5 py-2.5 font-medium">Estado</th>
                <th className="px-5 py-2.5 font-medium">Disponibilidade 24h</th>
                <th className="px-5 py-2.5 font-medium">Última verificação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sorted.map((site) => (
                <tr key={site.id} className="hover:bg-ink-50">
                  <td className="px-5 py-3">
                    <Link href={`/sites/${site.id}`} className="block">
                      <span className="font-medium text-ink-900">{site.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-400">{site.hostname}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <HealthBadge
                        severity={site.worstSeverity}
                        openFindings={site.openFindings}
                      />
                      {!site.verified && (
                        <span className="text-xs text-ink-400">{STATE_LABEL[site.state]}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-ink-600">
                    {formatUptime(site.uptime24h)}
                  </td>
                  <td className="px-5 py-3 text-ink-600">{formatRelative(site.lastRunAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
