'use client'

import { useActionState } from 'react'
import { formatDateTime } from '@/components/ui'
import { setNegotiatedDpaAction, type ActionState } from '../../actions'

/**
 * O estado do acordo de tratamento, visto pela equipa.
 *
 * A equipa não aceita nada aqui — quem aceita é o cliente, e o botão vive no
 * portal dele. O que esta secção faz é dizer se já aceitou, o que é preciso
 * saber antes de pôr um site a correr, e permitir registar que o cliente
 * impôs o contrato dele.
 *
 * Uma versão nova do acordo volta a pôr o cliente em falta, de propósito.
 * Aparecer aqui é como a equipa fica a saber que tem de o ir avisar.
 */
export function LegalPanel({
  organizationId,
  negotiatedRef,
  aceites,
  emFalta,
  oposicoes,
  canManage,
}: {
  organizationId: string
  negotiatedRef: string | null
  aceites: { title: string; version: number; acceptedAt: Date; representedBy: string }[]
  emFalta: { title: string; version: number }[]
  oposicoes: { id: string; reason: string; createdAt: Date; documentTitle: string }[]
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setNegotiatedDpaAction,
    {},
  )

  return (
    <div className="space-y-4 px-5 py-4">
      {negotiatedRef ? (
        <p className="text-sm text-ink-900">
          Contrato negociado à parte.{' '}
          <span className="text-ink-400">Referência: {negotiatedRef}</span>
        </p>
      ) : emFalta.length > 0 ? (
        <div>
          <p className="text-sm text-ink-900">
            {aceites.length > 0
              ? 'Há uma versão nova por aceitar.'
              : 'O cliente ainda não aceitou o acordo.'}
          </p>
          <ul className="mt-1 text-xs text-ink-400">
            {emFalta.map((documento) => (
              <li key={`${documento.title}-${documento.version}`}>
                {documento.title} v{documento.version}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-400">
            Enquanto não aceitar, o portal abre no acordo e o cliente não vê mais nada. A
            monitorização não é afetada.
          </p>
        </div>
      ) : aceites.length > 0 ? (
        <p className="text-sm text-ink-900">Acordo aceite.</p>
      ) : (
        <p className="text-sm text-ink-600">
          Ainda não há acordo publicado, por isso não há nada a aceitar.
        </p>
      )}

      {aceites.length > 0 && (
        <ul className="space-y-1 border-t border-ink-100 pt-3 text-xs text-ink-400">
          {aceites.map((aceite) => (
            <li key={`${aceite.title}-${aceite.version}`}>
              {aceite.title} v{aceite.version} — {formatDateTime(aceite.acceptedAt)} por{' '}
              {aceite.representedBy}
            </li>
          ))}
        </ul>
      )}

      {oposicoes.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
          <p className="text-xs font-medium text-amber-900">
            {oposicoes.length === 1 ? 'Oposição registada' : 'Oposições registadas'}
          </p>
          <ul className="mt-1.5 space-y-1.5 text-xs text-amber-900/80">
            {oposicoes.map((oposicao) => (
              <li key={oposicao.id}>
                {formatDateTime(oposicao.createdAt)} — {oposicao.documentTitle}:{' '}
                {oposicao.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && (
        <form action={action} className="border-t border-ink-100 pt-3">
          <label className="block text-xs text-ink-600">
            O cliente impôs o contrato dele? Indique a referência.
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              name="ref"
              defaultValue={negotiatedRef ?? ''}
              maxLength={200}
              placeholder="Ex.: DPA ACME 2026-03, assinado a 12/03"
              className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-jelly-500"
            />
            <input type="hidden" name="organizationId" value={organizationId} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              {pending ? 'A guardar…' : 'Guardar'}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-400">
            Preenchido, o cliente deixa de ver o pedido de aceitação. Vazio devolve-o ao fluxo
            normal.
          </p>
          {state.error && <p className="mt-2 text-xs text-jelly-600">{state.error}</p>}
          {state.message && <p className="mt-2 text-xs text-green-700">{state.message}</p>}
        </form>
      )}
    </div>
  )
}
