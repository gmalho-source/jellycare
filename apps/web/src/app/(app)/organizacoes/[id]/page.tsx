import { listMembers, listarContactos, schema } from '@jellycare/db'
import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardHeader, EmptyState, HealthBadge } from '@/components/ui'
import { getDb } from '@/lib/db'
import { listSites } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { AccessPanel } from '../../sites/[id]/access-panel'
import { apagarContactoAction } from '../actions'
import { FormularioContacto, RenomearOrganizacao } from '../formularios'

export const dynamic = 'force-dynamic'

/**
 * A ficha de um cliente: os contactos, os sites e quem tem acesso.
 *
 * Os contactos são a ficha de quem é quem no cliente, e quem recebe o
 * relatório mensal. Não são acessos: um contacto não entra no portal por
 * estar aqui. Para isso há «Quem tem acesso», mais abaixo.
 */
export default async function OrganizacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const user = await requireUser()

  const db = getDb()
  const [organizacao] = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, id))
    .limit(1)
  if (!organizacao) notFound()
  assertMembership(user, organizacao.id)
  const gere = canManage(user, organizacao.id)

  const [contactos, sites, membros] = await Promise.all([
    listarContactos(db, organizacao.id),
    listSites([organizacao.id]),
    listMembers(db, organizacao.id),
  ])
  const recebemRelatorios = contactos.filter((contacto) => contacto.receivesReports)

  return (
    <div className="space-y-6">
      <div>
        {user.isStaff ? (
          <Link href="/organizacoes" className="text-xs font-medium text-ink-400 hover:text-ink-900">
            ← Organizações
          </Link>
        ) : null}
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{organizacao.name}</h1>
        <p className="mt-1 text-sm text-ink-600">
          {sites.length} {sites.length === 1 ? 'site' : 'sites'} ·{' '}
          {recebemRelatorios.length === 0
            ? 'nenhum contacto recebe o relatório mensal'
            : `${recebemRelatorios.length} ${recebemRelatorios.length === 1 ? 'contacto recebe' : 'contactos recebem'} o relatório mensal`}
        </p>
      </div>

      {user.isStaff ? (
        <Card>
          <CardHeader title="Organização" />
          <RenomearOrganizacao organizationId={organizacao.id} nome={organizacao.name} />
        </Card>
      ) : null}

      <Card id="contactos">
        <CardHeader title="Contactos" />
        {contactos.length === 0 ? (
          <EmptyState>Ainda sem contactos.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink-100" data-contactos>
            {contactos.map((contacto) => (
              <li key={contacto.id} className="px-5 py-4" data-contacto-linha={contacto.email ?? contacto.name}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {contacto.name}
                      {contacto.jobTitle ? (
                        <span className="font-normal text-ink-600"> · {contacto.jobTitle}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-ink-600">
                      {contacto.email ? (
                        <a href={`mailto:${contacto.email}`} className="hover:underline">
                          {contacto.email}
                        </a>
                      ) : null}
                      {contacto.phone ? (
                        <a href={`tel:${contacto.phone.replace(/\s+/g, '')}`} className="hover:underline">
                          {contacto.phone}
                        </a>
                      ) : null}
                    </p>
                  </div>
                  {contacto.receivesReports ? (
                    <span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-900">
                      Recebe o relatório mensal
                    </span>
                  ) : null}
                </div>

                {gere ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-ink-600 hover:text-ink-900">
                      Editar
                    </summary>
                    <div className="mt-3 space-y-3">
                      <FormularioContacto organizationId={organizacao.id} contacto={contacto} />
                      <form action={apagarContactoAction}>
                        <input type="hidden" name="organizationId" value={organizacao.id} />
                        <input type="hidden" name="contactoId" value={contacto.id} />
                        <button type="submit" className="text-xs font-semibold text-mau hover:underline">
                          Apagar contacto
                        </button>
                      </form>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {gere ? (
          <div className="border-t border-ink-100 px-5 py-4">
            <p className="mb-3 text-sm font-semibold text-ink-900">Novo contacto</p>
            <FormularioContacto organizationId={organizacao.id} />
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Sites" />
        {sites.length === 0 ? (
          <EmptyState>
            Sem sites. {user.isStaff ? 'Um site muda-se para aqui nas definições dele, ou cria-se em «Adicionar site».' : ''}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-ink-100">
            {sites.map((site) => (
              <li key={site.id}>
                <Link
                  href={`/sites/${site.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-ink-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-900">{site.label}</span>
                    <span className="block truncate text-xs text-ink-400">{site.hostname}</span>
                  </span>
                  <HealthBadge severity={site.worstSeverity} openFindings={site.openFindings} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AccessPanel organizationId={organizacao.id} members={membros} currentUserId={user.id} canManage={gere} />
    </div>
  )
}
