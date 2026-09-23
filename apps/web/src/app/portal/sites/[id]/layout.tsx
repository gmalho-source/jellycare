import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { HealthBadge } from '@/components/ui'
import { getSiteHeader } from '@/lib/queries'
import { assertMembership, requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * O cabeçalho comum às secções do site, no portal.
 *
 * Lê a consulta leve e não o detalhe inteiro: corre em cada secção, e o
 * detalhe são oito consultas que só a visão geral precisa.
 */
export default async function PortalSiteLayout({
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
  // O identificador vir do URL nunca chega: confirma-se a pertença antes de
  // mostrar o que quer que seja.
  assertMembership(user, header.site.organizationId)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {header.site.label}
          </h1>
          <a
            href={header.site.url}
            rel="noreferrer noopener"
            target="_blank"
            className="mt-1 inline-block break-all text-sm text-ink-400 hover:text-ink-900"
          >
            {header.site.hostname}
          </a>
        </div>

        <HealthBadge severity={header.worstSeverity} openFindings={header.openFindings} />
      </div>

      <div className="space-y-6">{children}</div>
    </div>
  )
}
