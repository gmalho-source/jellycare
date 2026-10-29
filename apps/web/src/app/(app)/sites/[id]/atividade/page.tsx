import { contarAtividade, lerAtividade } from '@jellycare/db'
import { notFound } from 'next/navigation'
import { FiltrosDeAtividade } from '@/components/filtros-de-atividade'
import { RegistoDeAtividade, ResumoDeAtividade } from '@/components/registo-de-atividade'
import { lerFiltro } from '@/lib/atividade'
import { getDb } from '@/lib/db'
import { getSiteHeader } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const LIMITE = 300

/**
 * Tudo o que aconteceu a este site e o que se fez a respeito: problemas que
 * apareceram e se resolveram, ações da equipa, atualizações e avisos.
 */
export default async function AtividadeDoSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const user = await requireUser()

  const header = await getSiteHeader(id)
  if (!header) notFound()
  assertMembership(user, header.site.organizationId)

  const filtro = lerFiltro(await searchParams)
  const interno = canManage(user, header.site.organizationId)
  const db = getDb()
  const base = { siteIds: [id], desde: filtro.desde, incluirInternos: interno }

  const [linhas, contagem] = await Promise.all([
    lerAtividade(db, { ...base, ...(filtro.tipos ? { tipos: filtro.tipos } : {}), limite: LIMITE }),
    contarAtividade(db, base),
  ])

  return (
    <div className="space-y-6">
      <ResumoDeAtividade contagem={contagem} interno={interno} />
      <FiltrosDeAtividade
        base={`/sites/${id}/atividade`}
        filtro={filtro}
        familias={interno ? ['problemas', 'equipa', 'wordpress', 'avisos'] : ['problemas', 'wordpress', 'avisos']}
      />
      <RegistoDeAtividade
        linhas={linhas}
        vazio="Nada registado neste período."
        limiteAtingido={linhas.length === LIMITE}
      />
    </div>
  )
}
