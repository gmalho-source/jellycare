import { listarEquipa } from '@jellycare/db'
import { Card, CardHeader } from '@/components/ui'
import { getDb } from '@/lib/db'
import { requireStaff } from '@/lib/session'
import { AcrescentarEquipa, RetirarDaEquipa } from '../organizacoes/formularios'

export const dynamic = 'force-dynamic'

/**
 * A Equipa Jelly: quem tem acesso de administrador a todos os clientes.
 *
 * Um sítio só, em vez de uma pertença por organização. Quem entra aqui vê os
 * clientes de hoje e os que forem criados depois; quem sai deixa de os ver
 * todos de uma vez.
 */
export default async function EquipaPage() {
  const user = await requireStaff()
  const equipa = await listarEquipa(getDb())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Equipa Jelly</h1>
        <p className="mt-1 text-sm text-ink-600">
          Administradores de todas as organizações, as de hoje e as que vierem. Entram com o próprio email, sem
          palavra-passe.
        </p>
      </div>

      <Card>
        <CardHeader title="Acrescentar à equipa" />
        <AcrescentarEquipa />
      </Card>

      <Card>
        <CardHeader title={`${equipa.length} ${equipa.length === 1 ? 'pessoa' : 'pessoas'}`} />
        <ul className="divide-y divide-ink-100" data-equipa>
          {equipa.map((membro) => (
            <li key={membro.userId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-ink-900">{membro.email}</span>
                {membro.name ? <span className="block truncate text-xs text-ink-400">{membro.name}</span> : null}
              </span>
              {membro.userId === user.id ? (
                <span className="text-xs text-ink-400">Você</span>
              ) : (
                <RetirarDaEquipa userId={membro.userId} email={membro.email} />
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
