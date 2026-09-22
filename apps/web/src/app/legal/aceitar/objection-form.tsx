'use client'

import { useActionState, useState } from 'react'
import { objectToSubprocessorAction, type LegalActionState } from './actions'

/** O direito de oposição da cláusula 7.ª, com sítio onde ser exercido. */
export function ObjectionForm({
  organizationId,
  documentId,
}: {
  organizationId: string
  documentId: string
}) {
  const [state, action, pending] = useActionState<LegalActionState, FormData>(
    objectToSubprocessorAction,
    {},
  )
  const [aberto, setAberto] = useState(false)

  if (state.message) {
    return <p className="mt-3 text-sm text-green-700">{state.message}</p>
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="mt-3 text-xs font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
      >
        Opor-me a esta alteração
      </button>
    )
  }

  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="documentId" value={documentId} />
      <textarea
        name="reason"
        required
        rows={3}
        minLength={10}
        maxLength={2000}
        placeholder="Qual é o motivo, em duas linhas?"
        className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {pending ? 'A registar…' : 'Registar oposição'}
        </button>
        {state.error && <span className="text-xs text-amber-900">{state.error}</span>}
      </div>
    </form>
  )
}
