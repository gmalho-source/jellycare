'use client'

import { useActionState } from 'react'
import { formatDateTime } from '@/components/ui'
import { setAutoUpdateAction, type ActionState } from '../../actions'

/**
 * Atualizações automáticas, e o registo do que já foi feito.
 *
 * O registo não é decoração: um serviço gerido que atualiza sozinho tem de
 * conseguir responder a «quem mandou atualizar isto, quando, e de que versão
 * para que versão» — no dia em que um site parte, é a primeira pergunta.
 */

type Registo = {
  id: string
  name: string
  kind: string
  fromVersion: string | null
  toVersion: string | null
  status: string
  vulnerable: boolean
  orderedAt: Date
}

const ESTADO: Record<string, { texto: string; classe: string }> = {
  pending: { texto: 'a decorrer', classe: 'sev-info' },
  succeeded: { texto: 'aplicada', classe: 'sev-ok' },
  failed: { texto: 'falhou', classe: 'sev-high' },
  unknown: { texto: 'sem confirmação', classe: 'sev-medium' },
}

export function AutoUpdatePanel({
  siteId,
  enabled,
  hasWindow,
  history,
  canManage,
}: {
  siteId: string
  enabled: boolean
  hasWindow: boolean
  history: Registo[]
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setAutoUpdateAction,
    {},
  )

  return (
    <div className="space-y-4 px-5 py-4">
      <p className="text-sm text-ink-600">
        Com isto ligado, as atualizações de plugins e temas são aplicadas por nós dentro da janela
        de manutenção, com cópia de segurança e reversão automática se o site ficar mal. Só se
        atualiza um site que tenha cópia recente — sem ela, fica suspenso e é reportado.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <span
          className={
            enabled
              ? 'sev-ok rounded-full px-2.5 py-0.5 text-xs font-medium'
              : 'rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-600'
          }
        >
          {enabled ? 'ligada' : 'desligada'}
        </span>

        {enabled && !hasWindow && (
          <span className="sev-medium rounded-full px-2.5 py-0.5 text-xs font-medium">
            sem janela — nada será atualizado
          </span>
        )}

        {canManage && (
          <form action={action}>
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="enabled" value={enabled ? 'off' : 'on'} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              {pending ? 'A guardar…' : enabled ? 'Desligar' : 'Ligar'}
            </button>
          </form>
        )}
      </div>

      {state.error && <p className="text-sm text-jelly-600">{state.error}</p>}
      {state.message && <p className="text-sm text-green-700">{state.message}</p>}

      {history.length > 0 && (
        <ul className="divide-y divide-ink-100 border-t border-ink-100">
          {history.map((registo) => {
            const estado = ESTADO[registo.status] ?? ESTADO.unknown!
            return (
              <li
                key={registo.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:gap-4"
              >
                <span className="min-w-0 truncate text-ink-900">
                  {registo.name}
                  {registo.vulnerable && (
                    <span className="ml-1.5 text-xs text-[#a32233]">vulnerável</span>
                  )}
                </span>

                <span className="justify-self-end text-xs tabular-nums text-ink-400 sm:justify-self-start">
                  {registo.fromVersion ?? '?'} → {registo.toVersion ?? '?'}
                </span>

                <span className="col-span-2 flex items-center gap-2 text-xs text-ink-400 sm:col-span-1 sm:justify-self-end">
                  <span className={`${estado.classe} whitespace-nowrap rounded-full px-2 py-0.5`}>
                    {estado.texto}
                  </span>
                  {formatDateTime(registo.orderedAt)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
