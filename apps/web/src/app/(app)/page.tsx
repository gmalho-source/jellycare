import Link from 'next/link'
import { HealthBadge, formatRelative, formatUptime } from '@/components/ui'
import { SchedulerBanner } from '@/components/scheduler-banner'
import { listSites } from '@/lib/queries'
import { getCheckLiveness, getSchedulerHealth } from '@/lib/scheduler-health'
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
  const organizacoes = user.memberships.map((membership) => membership.organizationId)
  const [sites, agendador, checks] = await Promise.all([
    listSites(organizacoes),
    getSchedulerHealth(),
    // Só os sites deste utilizador: dizer-lhe que o `uptime` está atrasado em
    // três sites quando ele só tem um é um aviso que ele não pode verificar.
    getCheckLiveness(new Date(), organizacoes),
  ])

  // Com a monitorização parada, os números são os da última passagem. Dizer
  // «nenhum com problemas abertos» em cima disso é a afirmação que o painel
  // manteve durante dezoito horas enquanto não verificava nada.
  const aVigiar = agendador.status === 'ok' && checks.every((check) => check.late === 0)

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
      <SchedulerBanner health={agendador} checks={checks} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sites</h1>
          <p className="mt-1 text-sm text-ink-600">
            {sites.length === 0
              ? 'Ainda não há sites em monitorização.'
              : !aVigiar
                ? `${sites.length} ${sites.length === 1 ? 'site' : 'sites'} — números da última passagem, ver o aviso acima.`
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
          {/* Uma lista e não uma tabela.

              Quatro colunas de largura fixa não cabem num telemóvel, e uma
              tabela que rola na horizontal esconde metade da informação a
              quem só tem o telemóvel à mão. A mesma grelha empilha em duas
              linhas no ecrã pequeno e alinha em quatro colunas a partir de
              `sm`, sem duplicar marcação.

              A linha inteira passou a ser ligação: antes só o nome é que
              era, e tocar na disponibilidade não fazia nada — num ecrã táctil
              isso lê-se como avaria. */}
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_9rem_9rem] gap-4 border-b border-ink-200 bg-ink-50 px-5 py-2.5 text-xs uppercase tracking-wide text-ink-400 sm:grid">
            <span className="font-medium">Site</span>
            <span className="font-medium">Estado</span>
            <span className="font-medium">Disponibilidade 24h</span>
            <span className="font-medium">Última verificação</span>
          </div>

          <ul className="divide-y divide-ink-100">
            {sorted.map((site) => (
              <li key={site.id}>
                <Link
                  href={`/sites/${site.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm hover:bg-ink-50 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_9rem_9rem] sm:gap-4 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-900">{site.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-400">
                      {site.hostname}
                    </span>
                  </span>

                  <span className="flex items-center gap-2 justify-self-end sm:justify-self-start">
                    <HealthBadge severity={site.worstSeverity} openFindings={site.openFindings} />
                    {!site.verified && (
                      <span className="text-xs text-ink-400">{STATE_LABEL[site.state]}</span>
                    )}
                  </span>

                  {/* No pequeno as duas medidas partilham uma linha; a partir
                      de `sm` o `contents` desfaz este invólucro e cada uma
                      ocupa a sua coluna da grelha. */}
                  <span className="col-span-2 flex items-center gap-1.5 text-xs text-ink-400 sm:contents">
                    <span className="tabular-nums sm:text-sm sm:text-ink-600">
                      {formatUptime(site.uptime24h)}
                    </span>
                    <span aria-hidden className="sm:hidden">
                      ·
                    </span>
                    <span className="sm:text-sm sm:text-ink-600">
                      {formatRelative(site.lastRunAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
