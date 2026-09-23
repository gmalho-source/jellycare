import Link from 'next/link'
import { Icone } from '@/components/icons'
import { SchedulerBanner } from '@/components/scheduler-banner'
import { HealthBadge, Stat, formatRelative, formatUptime } from '@/components/ui'
import { listSites, ordenarPorGravidade } from '@/lib/queries'
import { requireUser } from '@/lib/session'
import { lerVigia } from '@/lib/vigia'

export const dynamic = 'force-dynamic'

const STATE_LABEL: Record<string, string> = {
  onboarding: 'Por verificar',
  active: 'Ativo',
  paused: 'Em pausa',
  archived: 'Arquivado',
}

/** A média das disponibilidades conhecidas. Um site sem dados não conta como zero. */
function mediaDisponibilidade(valores: readonly (number | null)[]): {
  media: number | null
  comDados: number
} {
  const conhecidos = valores.filter((valor): valor is number => valor !== null)
  if (conhecidos.length === 0) return { media: null, comDados: 0 }
  const soma = conhecidos.reduce((total, valor) => total + valor, 0)
  return { media: soma / conhecidos.length, comDados: conhecidos.length }
}

export default async function SitesPage() {
  const user = await requireUser()
  const organizacoes = user.memberships.map((membership) => membership.organizationId)

  const [sites, vigia] = await Promise.all([listSites(organizacoes), lerVigia(organizacoes)])

  const sorted = ordenarPorGravidade(sites)
  const comProblemas = sorted.filter((site) => site.worstSeverity !== null).length
  const porVerificar = sorted.filter((site) => !site.verified).length
  const { media, comDados } = mediaDisponibilidade(sorted.map((site) => site.uptime24h))
  const atrasados = vigia.checks.filter((check) => check.late > 0).length

  return (
    <div className="space-y-6">
      <SchedulerBanner health={vigia.health} checks={vigia.checks} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Sites</h1>
          <p className="mt-1 text-sm text-ink-600">
            {sites.length === 0
              ? 'Ainda não há sites em monitorização.'
              : !vigia.aVigiar
                ? `${sites.length} ${sites.length === 1 ? 'site' : 'sites'} — números da última passagem, ver o aviso acima.`
                : comProblemas === 0
                  ? `${sites.length} ${sites.length === 1 ? 'site' : 'sites'} em monitorização, nenhum com problemas abertos.`
                  : `${comProblemas} de ${sites.length} ${sites.length === 1 ? 'site' : 'sites'} com problemas abertos.`}
          </p>
        </div>

        {/* A ação principal é grafite e não vermelha: o vermelho da marca não
            compete com o vermelho do estado no mesmo ecrã. */}
        <Link
          href="/sites/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90"
        >
          <Icone nome="mais" className="h-3.5 w-3.5" />
          Adicionar site
        </Link>
      </div>

      {sorted.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            rotulo="Sites vigiados"
            valor={sorted.length}
            nota={
              porVerificar === 0
                ? 'todos com propriedade confirmada'
                : `${porVerificar} por verificar`
            }
          />
          <Stat
            rotulo="Com problemas abertos"
            valor={comProblemas}
            nota={
              comProblemas === 0
                ? 'nada em aberto neste momento'
                : `${sorted.reduce((total, site) => total + site.openFindings, 0)} problemas ao todo`
            }
          />
          <Stat
            rotulo="Disponibilidade 24 h"
            valor={formatUptime(media)}
            nota={
              comDados === 0
                ? 'ainda sem observações'
                : `média de ${comDados} ${comDados === 1 ? 'site' : 'sites'}`
            }
          />
          <Stat
            rotulo="Tipos de verificação"
            valor={vigia.checks.length}
            nota={
              atrasados === 0 ? 'nenhum em atraso' : `${atrasados} em atraso`
            }
          />
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-200 bg-white px-6 py-16 text-center">
          <p className="text-sm text-ink-600">
            Adicione o primeiro site para começar a monitorizar.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-white shadow-card">
          {/* Uma lista e não uma tabela. Quatro colunas de largura fixa não
              cabem num telemóvel, e uma tabela que rola na horizontal esconde
              metade da informação a quem só tem o telemóvel à mão: aqui as
              medidas passam para baixo do nome e nada sai do ecrã.

              A linha inteira é ligação. Antes só o nome é que era, e tocar na
              disponibilidade não fazia nada — num ecrã táctil isso lê-se como
              avaria. */}
          {sorted.map((site) => (
            <li key={site.id} className="border-b border-ink-100 last:border-0">
              <Link
                href={`/sites/${site.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50 sm:gap-4 sm:px-5 sm:py-3.5"
              >
                <span
                  aria-hidden
                  className={`sev-${site.worstSeverity ?? 'ok'} sev-ponto h-9 w-1 shrink-0 rounded-full`}
                />

                <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-sm font-semibold text-ink-600 sm:flex">
                  {site.label.trim().charAt(0).toUpperCase() || '·'}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-semibold tracking-tight text-ink-900">
                    {site.label}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {site.hostname}
                  </span>

                  {/* No telemóvel as medidas vivem debaixo do nome; a partir
                      de `sm` cada uma tem a sua coluna à direita. */}
                  <span className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
                    <HealthBadge severity={site.worstSeverity} openFindings={site.openFindings} />
                    <span className="font-mono text-xs tabular-nums text-ink-600">
                      {formatUptime(site.uptime24h)}
                    </span>
                    <span className="text-xs text-ink-400">{formatRelative(site.lastRunAt)}</span>
                  </span>
                </span>

                <span className="hidden w-20 text-right font-mono text-sm tabular-nums text-ink-600 sm:block">
                  {formatUptime(site.uptime24h)}
                </span>

                <span className="hidden w-40 justify-end gap-2 sm:flex">
                  {!site.verified && (
                    <span className="self-center text-xs text-ink-400">
                      {STATE_LABEL[site.state]}
                    </span>
                  )}
                  <HealthBadge severity={site.worstSeverity} openFindings={site.openFindings} />
                </span>

                <span className="hidden w-24 text-right text-xs text-ink-400 sm:block">
                  {formatRelative(site.lastRunAt)}
                </span>

                <Icone nome="seta" className="hidden h-4 w-4 shrink-0 text-ink-200 sm:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
