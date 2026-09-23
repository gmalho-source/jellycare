import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { Shell, type SiteNaBarra } from '@/components/shell'
import { listSites, ordenarPorGravidade } from '@/lib/queries'
import { canManage, isClientOnly, requireUser } from '@/lib/session'
import { sectionsFor } from '@/lib/site-nav'
import { lerVigia } from '@/lib/vigia'
import { signOut } from './actions'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()
  // O painel interno mostra configuração, tokens de verificação e o inventário
  // de todos os sites da organização. Um cliente não tem nada que fazer aqui.
  if (isClientOnly(user)) redirect('/portal')

  const organizacoes = user.memberships.map((membership) => membership.organizationId)
  const [sites, { resumo }] = await Promise.all([listSites(organizacoes), lerVigia(organizacoes)])

  // As secções são decididas aqui e não na barra: quem tem ligação a uma
  // ferramenta de manutenção e quem pode gerir a organização são perguntas do
  // servidor, e a barra só desenha o que lhe for dado.
  const naBarra: SiteNaBarra[] = ordenarPorGravidade(sites).map((site) => ({
    id: site.id,
    label: site.label,
    severity: site.worstSeverity,
    seccoes: sectionsFor({
      hasConnector: site.hasConnector,
      canManage: canManage(user, site.organizationId),
    }).map((seccao) => ({ slug: seccao.slug, label: seccao.label })),
  }))

  return (
    <Shell email={user.email} vigia={resumo} sites={naBarra} sair={signOut}>
      {children}
    </Shell>
  )
}
