import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { Icone } from '@/components/icons'
import { HealthBadge } from '@/components/ui'
import { getSiteHeader } from '@/lib/queries'
import { assertMembership, requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * O que é comum a todas as secções de um site.
 *
 * Só o cabeçalho: a navegação entre secções vive na barra lateral, na rota
 * paralela `@rail`, para que a coluna escura seja o único sítio onde se muda
 * de sítio.
 *
 * Lê a consulta leve e não o detalhe inteiro: carregar as oito consultas do
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {header.site.label}
          </h1>
          <a
            href={header.site.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex items-center gap-1.5 break-all text-sm text-ink-400 hover:text-ink-900"
          >
            {header.site.url}
            <Icone nome="externo" className="h-3.5 w-3.5 shrink-0" />
          </a>
        </div>

        <div className="flex items-center gap-2">
          {!header.verified && (
            <span className="sev-medium inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold">
              Por verificar
            </span>
          )}
          <HealthBadge severity={header.worstSeverity} openFindings={header.openFindings} />
        </div>
      </div>

      <div className="space-y-6">{children}</div>
    </div>
  )
}
