import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { Shell, type SiteNaBarra } from '@/components/shell'
import { getLegalState } from '@/lib/legal'
import { listSites, ordenarPorGravidade } from '@/lib/queries'
import { requireUser } from '@/lib/session'
import { signOut } from '../(app)/actions'

/**
 * Portal do cliente.
 *
 * Mora na mesma aplicação que o painel interno e partilha a autenticação, as
 * consultas e os componentes. O que muda é o que se mostra e como se diz: aqui
 * não há configuração, não há tokens de verificação, não há seletores CSS nem
 * nomes de checks. Um cliente quer saber se o site dele está bem, o que foi
 * encontrado, e ter os relatórios à mão.
 *
 * A equipa da Jelly também pode entrar, de propósito: ver o que o cliente vê
 * antes de uma reunião vale mais do que qualquer descrição.
 *
 * Usa a mesma moldura do painel interno, **sem a pastilha do vigia**. Um
 * agendador parado é falha nossa, não do site do cliente, e é a mesma regra
 * que já esconde a faixa de aviso e a cobertura reduzida.
 */

/** As secções que um cliente tem em cada site. */
const SECCOES = [
  { slug: '', label: 'Visão geral', icone: 'geral' },
  { slug: 'desempenho', label: 'Desempenho', icone: 'desempenho' },
  { slug: 'relatorios', label: 'Relatórios', icone: 'relatorios' },
]

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()

  // Sem acordo de tratamento aceite, o portal abre no acordo.
  //
  // O bloqueio é aqui e não no painel interno de propósito. Tratar dados sem
  // contrato escrito é a infração; mas parar o trabalho da equipa porque o
  // cliente ainda não carregou num botão punia quem não pode resolver. O
  // cliente é quem aceita, e é a ele que se pede antes de mais nada.
  //
  // O ecrã de aceitação vive em `/legal/aceitar`, fora deste layout. Se
  // vivesse dentro dele, este encaminhamento apontava para uma página que o
  // volta a disparar — um ciclo. Estar fora resolve-o por construção, em vez
  // de por uma exceção ao caminho que alguém um dia esquecia.
  const pertenca = user.memberships.find((m) => m.role === 'client')
  if (pertenca) {
    const estado = await getLegalState(pertenca.organizationId)
    if (estado.missing.length > 0 && !estado.negotiatedRef) redirect('/legal/aceitar')
  }

  const sites = ordenarPorGravidade(
    await listSites(user.memberships.map((membership) => membership.organizationId)),
  )

  const naBarra: SiteNaBarra[] = sites.map((site) => ({
    href: `/portal/sites/${site.id}`,
    label: site.label,
    severity: site.worstSeverity,
    seccoes: SECCOES.map((seccao) => ({
      href:
        seccao.slug.length === 0
          ? `/portal/sites/${site.id}`
          : `/portal/sites/${site.id}/${seccao.slug}`,
      label: seccao.label,
      icone: seccao.icone,
      exato: seccao.slug.length === 0,
    })),
  }))

  return (
    <Shell
      email={user.email}
      inicio={{ href: '/portal', label: 'Os meus sites', icone: 'sites', exato: true }}
      globais={[{ href: '/legal/aceitar', label: 'Tratamento de dados', icone: 'relatorios' }]}
      grupo="Os seus sites"
      sites={naBarra}
      sair={signOut}
    >
      {children}

      <footer className="mt-10 text-xs text-ink-400">
        Alguma dúvida sobre o que está aqui? Fale connosco — estes números são o nosso trabalho e
        explicá-los faz parte dele.
      </footer>
    </Shell>
  )
}
