import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { HealthBadge } from '@/components/ui'
import { getSiteHeader } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { sectionsFor } from '@/lib/site-nav'
import { SiteNav } from './site-nav'

export const dynamic = 'force-dynamic'

/**
 * O que é comum a todas as secções de um site.
 *
 * O cabeçalho e a navegação correm em cada separador, por isso lêem a
 * consulta leve e não o detalhe inteiro: carregar as oito consultas do
 * detalhe em cada visita a cada separador era o custo que a divisão em
 * secções serve precisamente para evitar.
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()

  const header = await getSiteHeader(id)
  if (!header) notFound()

  assertMembership(user, header.site.organizationId)
  const manageable = canManage(user, header.site.organizationId)

  const sections = sectionsFor({
    hasConnector: header.hasConnector,
    canManage: manageable,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{header.site.label}</h1>
          <a
            href={header.site.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-block break-all text-sm text-ink-600 hover:text-jelly-500"
          >
            {header.site.url}
          </a>
        </div>

        <div className="flex items-center gap-2">
          {!header.verified && (
            <span className="sev-medium rounded-full px-2.5 py-0.5 text-xs font-medium">
              Por verificar
            </span>
          )}
          <HealthBadge severity={header.worstSeverity} openFindings={header.openFindings} />
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
        <SiteNav siteId={id} sections={sections} />
        <div className="mt-4 space-y-6 lg:mt-0">{children}</div>
      </div>
    </div>
  )
}
