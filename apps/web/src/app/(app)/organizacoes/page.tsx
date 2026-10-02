import { listarOrganizacoes } from '@jellycare/db'
import Link from 'next/link'
import { Icone } from '@/components/icons'
import { Card, CardHeader } from '@/components/ui'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/session'
import { NovaOrganizacao } from './formularios'

export const dynamic = 'force-dynamic'

/**
 * Os clientes da Jelly, cada um na sua organização.
 *
 * Só para a Equipa Jelly. Cada cliente na sua organização é o que isola o
 * portal: o acesso de cliente vale para a organização inteira.
 */
export default async function OrganizacoesPage() {
  await requireStaff()
  const organizacoes = await listarOrganizacoes(getDb())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Organizações</h1>
        <p className="mt-1 text-sm text-ink-600">
          {organizacoes.length} {organizacoes.length === 1 ? 'organização' : 'organizações'}. Cada cliente tem a
          sua: quem tem acesso de cliente vê no portal todos os sites da organização.
        </p>
      </div>

      <Card>
        <CardHeader title="Nova organização" />
        <NovaOrganizacao />
      </Card>

      <ul className="overflow-hidden rounded-2xl bg-white shadow-card" data-organizacoes>
        {organizacoes.map((organizacao) => (
          <li key={organizacao.id} className="border-b border-ink-100 last:border-0">
            <Link
              href={`/organizacoes/${organizacao.id}`}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-ink-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-sm font-semibold text-ink-600">
                {organizacao.name.trim().charAt(0).toUpperCase() || '·'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-semibold tracking-tight text-ink-900">
                  {organizacao.name}
                </span>
                <span className="mt-0.5 block text-xs text-ink-400">
                  {organizacao.sites} {organizacao.sites === 1 ? 'site' : 'sites'} · {organizacao.contactos}{' '}
                  {organizacao.contactos === 1 ? 'contacto' : 'contactos'} · {organizacao.acessos}{' '}
                  {organizacao.acessos === 1 ? 'pessoa com acesso' : 'pessoas com acesso'}
                </span>
              </span>
              <Icone nome="seta" className="h-4 w-4 shrink-0 text-ink-200" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
