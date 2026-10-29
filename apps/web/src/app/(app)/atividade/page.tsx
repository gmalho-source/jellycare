import { contarAtividade, lerAtividade } from '@jellycare/db'
import { FiltrosDeAtividade } from '@/components/filtros-de-atividade'
import { RegistoDeAtividade, ResumoDeAtividade } from '@/components/registo-de-atividade'
import { hrefComFiltro, lerFiltro } from '@/lib/atividade'
import { getDb } from '@/lib/db'
import { listSites } from '@/lib/queries'
import { requireStaff } from '@/lib/session'

export const dynamic = 'force-dynamic'

const LIMITE = 300

/**
 * A atividade de todos os sites, para a Equipa Jelly.
 *
 * A resposta a «o que é que resolvemos este mês», sem abrir site a site.
 */
export default async function AtividadeGlobalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireStaff()
  const filtro = lerFiltro(await searchParams)

  const sites = await listSites(user.memberships.map((membership) => membership.organizationId))
  const ordenados = [...sites].sort((a, b) => a.label.localeCompare(b.label, 'pt'))
  const siteIds = filtro.siteId
    ? ordenados.filter((site) => site.id === filtro.siteId).map((site) => site.id)
    : ordenados.map((site) => site.id)

  const db = getDb()
  const base = { siteIds, desde: filtro.desde, incluirInternos: true }
  const [linhas, contagem] = await Promise.all([
    lerAtividade(db, { ...base, ...(filtro.tipos ? { tipos: filtro.tipos } : {}), limite: LIMITE }),
    contarAtividade(db, base),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Atividade</h1>
        <p className="mt-1 text-sm text-ink-600">
          O que aconteceu nos sites e o que se fez a respeito: problemas detetados e resolvidos, ações da equipa,
          pedidos ao Claude Resolve, atualizações e avisos ao cliente.
        </p>
      </div>

      <ResumoDeAtividade contagem={contagem} interno />

      <div className="space-y-3">
        <FiltrosDeAtividade
          base="/atividade"
          filtro={filtro}
          familias={['problemas', 'equipa', 'wordpress', 'avisos']}
        />
        <form action="/atividade" className="flex flex-wrap items-center gap-2 text-sm">
          {filtro.periodo !== '30d' && <input type="hidden" name="periodo" value={filtro.periodo} />}
          {filtro.familia && <input type="hidden" name="tipo" value={filtro.familia} />}
          <label htmlFor="site" className="text-xs text-ink-400">
            Site
          </label>
          <select
            id="site"
            name="site"
            defaultValue={filtro.siteId ?? ''}
            className="rounded-lg border border-ink-100 bg-white px-2 py-1 text-sm"
          >
            <option value="">Todos os sites</option>
            {ordenados.map((site) => (
              <option key={site.id} value={site.id}>
                {site.label}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-ink-900 px-3 py-1 text-xs font-medium text-white">
            Filtrar
          </button>
          {filtro.siteId && (
            <a href={hrefComFiltro('/atividade', filtro, { siteId: null })} className="text-xs text-ink-400 underline">
              limpar
            </a>
          )}
        </form>
      </div>

      <RegistoDeAtividade
        linhas={linhas}
        mostrarSite
        hrefDoSite={(siteId) => `/sites/${siteId}/atividade`}
        vazio="Nada registado neste período."
        limiteAtingido={linhas.length === LIMITE}
      />
    </div>
  )
}
