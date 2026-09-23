'use client'

import { useActionState } from 'react'
import { acceptLegalDocumentsAction, type LegalActionState } from './actions'

/**
 * O ecrã onde o acordo é aceite.
 *
 * Duas exigências que não são decoração. O texto integral está na página,
 * acima deste formulário — ninguém aceita uma ligação. E o cargo é escrito à
 * mão, com a confirmação expressa de que quem o escreve pode vincular a
 * empresa: sem isso, a aceitação prova que alguém carregou num botão, não
 * que a empresa se obrigou.
 */
export function AcceptForm({
  organizationId,
  documentIds,
  titulos,
}: {
  organizationId: string
  documentIds: string[]
  titulos: string[]
}) {
  const [state, action, pending] = useActionState<LegalActionState, FormData>(
    acceptLegalDocumentsAction,
    {},
  )

  return (
    <form action={action} className="rounded-2xl bg-white shadow-card p-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      {documentIds.map((id) => (
        <input key={id} type="hidden" name="documentId" value={id} />
      ))}

      <h2 className="text-sm font-semibold text-ink-900">
        Aceitar {titulos.length === 1 ? 'o documento acima' : 'os documentos acima'}
      </h2>

      <label className="mt-4 block">
        <span className="text-sm text-ink-600">
          O seu cargo na empresa
        </span>
        <input
          name="representedBy"
          required
          maxLength={120}
          placeholder="Ex.: Administrador, Diretor de Marketing"
          className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-jelly-500"
        />
      </label>

      <label className="mt-4 flex items-start gap-2.5">
        <input
          type="checkbox"
          name="confirma"
          required
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-200"
        />
        <span className="text-sm text-ink-600">
          Li o texto acima e tenho poderes para vincular a empresa a este acordo.
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:opacity-50"
        >
          {pending ? 'A registar…' : 'Aceitar'}
        </button>
        {state.error && <span className="text-sm text-mau">{state.error}</span>}
        {state.message && <span className="text-sm text-green-700">{state.message}</span>}
      </div>
    </form>
  )
}
