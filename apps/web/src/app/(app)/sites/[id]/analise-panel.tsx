'use client'

import { useActionState } from 'react'
import { Icone } from '@/components/icons'
import { requestPageSpeedAction, type PageSpeedRequestState } from '../../actions'

/**
 * Pedir uma medição de velocidade sem esperar pela passagem diária.
 *
 * O botão não mede nada: deixa as verificações prontas a correr e o agendador
 * apanha-as na passagem seguinte. Daí a linguagem — «pedido registado» e não
 * «analisado». Dizer que já está feito quando ainda não está é prometer a
 * quem olha para o ecrã uma coisa que pode ainda falhar, e é o mesmo cuidado
 * que o pedido de relatório já tem.
 */
export function AnalisePanel({ siteId }: { siteId: string }) {
  const [state, action, pending] = useActionState<PageSpeedRequestState, FormData>(
    requestPageSpeedAction,
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
          {pending ? 'A pedir…' : 'Analisar agora'}
        </button>
      </form>
    </span>
  )
}
