import { contarAtividade, lerAtividade } from '@jellycare/db'
import { notFound } from 'next/navigation'
import { FiltrosDeAtividade } from '@/components/filtros-de-atividade'
import { RegistoDeAtividade, ResumoDeAtividade } from '@/components/registo-de-atividade'
import { lerFiltro } from '@/lib/atividade'
import { getDb } from '@/lib/db'
import { getSiteHeader } from '@/lib/queries'
import { assertMembership, requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

const LIMITE = 300

/**
 * O que aconteceu ao site e o que a Jelly fez, visto pelo cliente.
 *
 * Sem o que é só da equipa: quem silenciou o quê e os pedidos ao Claude
 * ficam no painel interno, mesmo quando é alguém da Jelly a abrir o portal —
 * é para isso que a equipa entra aqui, para ver o que o cliente vê.
 */
export default async function PortalAtividadePage({
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
  const db = getDb()
  const base = { siteIds: [id], desde: filtro.desde, incluirInternos: false }

  const [linhas, contagem] = await Promise.all([
    lerAtividade(db, { ...base, ...(filtro.tipos ? { tipos: filtro.tipos } : {}), limite: LIMITE }),
    contarAtividade(db, base),
  ])

  return (
    <div className="space-y-6">
      <ResumoDeAtividade contagem={contagem} interno={false} />
      <FiltrosDeAtividade
        base={`/portal/sites/${id}/atividade`}
        filtro={filtro}
        familias={['problemas', 'wordpress', 'avisos']}
      />
      <RegistoDeAtividade
        linhas={linhas}
        vazio="Nada registado neste período."
        limiteAtingido={linhas.length === LIMITE}
      />
    </div>
  )
}
