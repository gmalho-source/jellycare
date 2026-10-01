'use client'

import { useActionState } from 'react'
import { Icone } from '@/components/icons'
import { requestReputationAction, type ReputationRequestState } from '../../actions'

/**
 * Pedir a verificação de reputação sem esperar pela passagem diária.
 *
 * Como o «Analisar agora» da velocidade, o botão não verifica nada: deixa a
 * verificação pronta e o agendador apanha-a. Daí «pedido registado» e não
 * «verificado».
 */
export function VerificarReputacao({ siteId }: { siteId: string }) {
  const [state, action, pending] = useActionState<ReputationRequestState, FormData>(
    requestReputationAction,
    {},
  )

  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {state.message && <span className="text-xs text-ink-400">{state.message}</span>}
      {state.error && <span className="text-xs font-medium text-mau">{state.error}</span>}
      <form action={action}>
        <input type="hidden" name="siteId" value={siteId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-900 hover:bg-ink-50 disabled:opacity-60"
        >
          <Icone nome="atualizar" className="h-3.5 w-3.5" />
          {pending ? 'A pedir…' : 'Verificar agora'}
        </button>
      </form>
    </span>
  )
}
