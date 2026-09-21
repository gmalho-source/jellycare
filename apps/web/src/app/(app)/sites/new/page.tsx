import { schema } from '@jellycare/db'
import { inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { NewSiteForm } from './form'

export const dynamic = 'force-dynamic'

export default async function NewSitePage() {
  const user = await requireUser()

  const organizationIds = user.memberships
    .filter((membership) => membership.role !== 'client')
    .map((membership) => membership.organizationId)

  const organizations =
    organizationIds.length > 0
      ? await getDb()
          .select({ id: schema.organizations.id, name: schema.organizations.name })
          .from(schema.organizations)
          .where(inArray(schema.organizations.id, organizationIds))
          .orderBy(schema.organizations.name)
      : []

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Adicionar site</h1>
        <p className="mt-1 text-sm text-ink-600">
          O site começa em disponibilidade. As restantes verificações ativam-se assim que a
          propriedade do domínio estiver comprovada.
        </p>
      </div>

      {organizations.length === 0 ? (
        <div className="rounded-xl border border-ink-200 bg-white px-6 py-10 text-center text-sm text-ink-600">
          Não tem permissão para adicionar sites em nenhuma organização.
        </div>
      ) : (
        <NewSiteForm organizations={organizations} />
      )}
    </div>
  )
}
