import { cookies } from 'next/headers'
import Link from 'next/link'
import { Icone } from '@/components/icons'
import { ListaDeSites } from '@/components/lista-de-sites'
import { SchedulerBanner } from '@/components/scheduler-banner'
import { Stat, formatUptime } from '@/components/ui'
import { COOKIE_VISTA_SITES, vistaSitesDe } from '@/lib/pesquisa-sites'
import { listSites, ordenarPorGravidade } from '@/lib/queries'
import { requireUser } from '@/lib/session'
import { lerVigia } from '@/lib/vigia'

export const dynamic = 'force-dynamic'

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
  const vista = vistaSitesDe((await cookies()).get(COOKIE_VISTA_SITES)?.value)

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
        <ListaDeSites sites={sorted} vistaInicial={vista} />
      )}
    </div>
  )
}
