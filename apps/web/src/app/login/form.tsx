'use client'

import { useActionState } from 'react'
import { requestLoginLink, type LoginState } from './actions'

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(requestLoginLink, {})

  return (
    <form action={action} className="space-y-4 rounded-2xl bg-white p-6 shadow-raised">
      <div>
        <label htmlFor="email" className="text-sm font-medium text-ink-900">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 px-3.5 text-sm outline-none focus:border-jelly-500 focus:ring-2 focus:ring-jelly-100"
          placeholder="nome@jelly.pt"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-xl bg-jelly-500 px-4 text-sm font-semibold text-white hover:bg-jelly-600 disabled:opacity-50"
      >
        {pending ? 'A enviar…' : 'Enviar ligação de entrada'}
      </button>

      {state.message && <p className="text-sm text-ink-600">{state.message}</p>}
      {state.error && <p className="text-sm text-jelly-700">{state.error}</p>}

      <p className="text-xs text-ink-400">
        Não usamos palavras-passe. Enviamos uma ligação de uso único, válida 15 minutos.
      </p>
    </form>
  )
}
