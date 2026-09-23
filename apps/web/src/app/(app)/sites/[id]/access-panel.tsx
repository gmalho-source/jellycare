'use client'

import { useActionState } from 'react'
import type { OrganizationMember } from '@jellycare/db'
import { Card, CardHeader, EmptyState, formatDateTime } from '@/components/ui'
import {
  grantAccessAction,
  resendAccessAction,
  revokeAccessAction,
  type AccessState,
} from '../../actions'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  member: 'Equipa',
  client: 'Cliente',
}

/**
 * Quem vê este site, e como dar acesso a mais alguém.
 *
 * Vive na página do site e não numa secção de definições porque é aqui que a
 * pergunta aparece: quando se está a olhar para o que um cliente devia poder
 * ver. A organização vem do site, por isso não há nada para escolher.
 */
export function AccessPanel({
  organizationId,
  members,
  currentUserId,
  canManage,
}: {
  organizationId: string
  members: OrganizationMember[]
  currentUserId: string
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<AccessState, FormData>(grantAccessAction, {})
  // Um estado só para todas as linhas: o `useActionState` devolve uma ação que
  // qualquer formulário pode usar, e a mensagem diz de quem se trata.
  const [resendState, resendAction, resending] = useActionState<AccessState, FormData>(
    resendAccessAction,
    {},
  )

  return (
    <Card>
      <CardHeader title="Quem tem acesso" />

      {members.length === 0 ? (
        <EmptyState>Ninguém, além de si.</EmptyState>
      ) : (
        <ul className="divide-y divide-ink-100">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-ink-900">{member.email}</p>
                <p className="text-xs text-ink-400">
                  {ROLE_LABEL[member.role] ?? member.role} · desde{' '}
                  {formatDateTime(member.since)}
                </p>
              </div>

              {canManage ? (
                <div className="flex items-center gap-1">
                  <form action={resendAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="userId" value={member.userId} />
                    <button
                      type="submit"
                      disabled={resending}
                      className="rounded-md px-2 py-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50"
                    >
                      Reenviar convite
                    </button>
                  </form>

                  {member.userId !== currentUserId && member.role !== 'owner' ? (
                    <form action={revokeAccessAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="userId" value={member.userId} />
                      <button
                        type="submit"
                        className="rounded-md px-2 py-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-900"
                      >
                        Retirar acesso
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {resendState.message || resendState.error ? (
        <p
          className={`border-t border-ink-100 px-5 py-3 text-sm ${
            resendState.error ? 'text-red-600' : 'text-ink-600'
          }`}
        >
          {resendState.error ?? resendState.message}
        </p>
      ) : null}

      {canManage ? (
        <form action={action} className="border-t border-ink-100 px-5 py-4">
          <input type="hidden" name="organizationId" value={organizationId} />

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <label htmlFor="access-email" className="block text-xs text-ink-400">
                Email
              </label>
              <input
                id="access-email"
                name="email"
                type="email"
                required
                placeholder="pessoa@cliente.pt"
                className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="access-role" className="block text-xs text-ink-400">
                Papel
              </label>
              <select
                id="access-role"
                name="role"
                defaultValue="client"
                className="mt-1 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
              >
                <option value="client">Cliente — portal, só leitura</option>
                <option value="member">Equipa — painel completo</option>
                <option value="admin">Administrador</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:opacity-60"
            >
              {pending ? 'A dar acesso…' : 'Dar acesso'}
            </button>
          </div>

          <p className="mt-2 text-xs text-ink-400">
            A pessoa recebe um aviso por email e entra pedindo a sua própria ligação em{' '}
            <code>/login</code>. Não enviamos ligações de entrada por convite: são válidas
            quinze minutos e de uso único.
          </p>

          {state.error ? <p className="mt-2 text-sm text-red-600">{state.error}</p> : null}
          {state.message ? <p className="mt-2 text-sm text-ink-600">{state.message}</p> : null}
        </form>
      ) : null}
    </Card>
  )
}
