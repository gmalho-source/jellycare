import Link from 'next/link'
import { HealthBadge, formatRelative, formatUptime } from '@/components/ui'
import { listSites } from '@/lib/queries'
import { requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * A primeira coisa que o cliente lê.
 *
 * O painel interno começa por uma tabela, porque quem o abre gere dezenas de
 * sites e quer densidade. Aqui é o contrário: um cliente tem um site, talvez
 * três, e o que quer saber cabe numa frase. A frase vem primeiro; os números
 * vêm a seguir, para quem os quiser.
 */
export default async function PortalPage() {
  const user = await requireUser()
  const sites = await listSites(user.memberships.map((membership) => membership.organizationId))

  const comProblemas = sites.filter((site) => site.worstSeverity !== null)
  const tudoBem = sites.length > 0 && comProblemas.length === 0

  const resumo = (() => {
    if (sites.length === 0) return 'Ainda não há nada a monitorizar.'
    if (tudoBem) {
      return sites.length === 1
        ? 'O seu site está a ser vigiado e não há nada em aberto.'
        : `Os seus ${sites.length} sites estão a ser vigiados e não há nada em aberto.`
    }
    return comProblemas.length === 1
      ? 'Há um site com problemas por resolver.'
      : `Há ${comProblemas.length} sites com problemas por resolver.`
  })()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {tudoBem ? 'Está tudo em ordem' : sites.length === 0 ? 'Bem-vindo' : 'A precisar de atenção'}
        </h1>
        <p className="mt-1 text-sm text-ink-600">{resumo}</p>
      </div>

      {sites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-16 text-center">
          <p className="text-sm text-ink-600">
            Assim que a Jelly ligar o primeiro site, ele aparece aqui.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sites.map((site) => (
            <Link
              key={site.id}
              href={`/portal/sites/${site.id}`}
              className="block rounded-xl border border-ink-200 bg-white p-5 transition hover:border-jelly-500"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{site.label}</p>
                  <p className="truncate text-xs text-ink-400">{site.hostname}</p>
                </div>
                <HealthBadge severity={site.worstSeverity} openFindings={site.openFindings} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-ink-400">Disponível (24 h)</dt>
                  <dd className="text-ink-900">{formatUptime(site.uptime24h)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-400">Última verificação</dt>
                  <dd className="text-ink-900">{formatRelative(site.lastRunAt)}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
