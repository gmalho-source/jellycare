'use client'

import { useActionState, useState } from 'react'
import { formatDateTime } from '@/components/ui'
import { setMaintenanceWindowAction, type ActionState } from '../../actions'
import { ScheduleField, type Horario } from './schedule-field'

/**
 * Janelas de manutenção.
 *
 * Durante uma janela os alertas ficam suspensos, mas as verificações
 * continuam a correr e os problemas continuam a ser registados. É essa a
 * promessa que o texto do painel tem de fazer, porque é o que muda a decisão
 * de quem a declara: não se está a deixar de vigiar, está-se a deixar de
 * acordar pessoas.
 *
 * A conversão do fuso acontece aqui e não no servidor. Um `datetime-local`
 * dá a hora escrita, sem fuso; interpretá-la no servidor dava-lhe UTC, que é
 * o fuso do contentor e de mais ninguém. Quem escrevesse 22h em Lisboa
 * ficava com a janela às 23h. O browser é o único que sabe onde está quem
 * escreveu — e o rótulo diz qual é esse fuso, para não haver dúvida a quem
 * trabalha entre dois.
 *
 * A conversão está em campos escondidos que acompanham o que se escreve, e
 * não num `onSubmit` a reescrever os campos visíveis. Com uma ação de
 * formulário, o React já recolheu o `FormData` quando esse handler corre:
 * o servidor recebia a hora por converter e a janela ficava no fuso errado
 * — ou não ficava de todo.
 */

const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone

function paraIso(local: string): string {
  const data = new Date(local)
  return Number.isNaN(data.getTime()) ? '' : data.toISOString()
}

type Janela = { start: string; end: string; estado: 'a decorrer' | 'agendada' | 'terminada' }

export function MaintenancePanel({
  siteId,
  windows,
  schedule,
  canManage,
}: {
  siteId: string
  windows: Janela[]
  schedule: Horario | null
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setMaintenanceWindowAction,
    {},
  )
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')

  return (
    <div className="space-y-4 px-5 py-4">
      <p className="text-sm text-ink-600">
        Durante uma janela os alertas ficam suspensos. As verificações continuam a correr e o que
        for encontrado continua a ser registado — só não acorda ninguém. É também a janela que
        autoriza a manutenção automática a mexer no site.
      </p>

      <ScheduleField siteId={siteId} schedule={schedule} canManage={canManage} />

      <p className="border-t border-ink-100 pt-3 text-xs font-medium text-ink-600">
        Janelas avulsas
      </p>

      {windows.length === 0 ? (
        <p className="text-sm text-ink-400">Nenhuma janela declarada.</p>
      ) : (
        <ul className="divide-y divide-ink-100 border-y border-ink-100">
          {windows.map((janela) => (
            <li
              key={`${janela.start}-${janela.end}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 text-sm"
            >
              <span className="min-w-0 text-ink-900">
                {formatDateTime(janela.start)} — {formatDateTime(janela.end)}
              </span>
              <span
                className={
                  janela.estado === 'a decorrer'
                    ? 'sev-medium justify-self-end whitespace-nowrap rounded-full px-2 py-0.5 text-xs'
                    : 'justify-self-end whitespace-nowrap text-xs text-ink-400'
                }
              >
                {janela.estado}
              </span>

              {canManage && (
                <form action={action} className="col-span-2 justify-self-start">
                  <input type="hidden" name="siteId" value={siteId} />
                  <input type="hidden" name="operacao" value="remover" />
                  <input type="hidden" name="start" value={janela.start} />
                  <input type="hidden" name="end" value={janela.end} />
                  <button
                    type="submit"
                    className="text-xs text-ink-400 underline underline-offset-2 hover:text-ink-600"
                  >
                    Remover
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form action={action}>
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="operacao" value="adicionar" />
          <input type="hidden" name="start" value={paraIso(inicio)} />
          <input type="hidden" name="end" value={paraIso(fim)} />

          <p className="text-xs text-ink-400">Horas em {FUSO}</p>
          <div className="mt-1.5 flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1">
              <span className="block text-xs text-ink-600">Início</span>
              <input
                type="datetime-local"
                value={inicio}
                onChange={(event) => setInicio(event.target.value)}
                required
                aria-label="Início da janela"
                className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-jelly-500"
              />
            </label>
            <label className="min-w-0 flex-1">
              <span className="block text-xs text-ink-600">Fim</span>
              <input
                type="datetime-local"
                value={fim}
                onChange={(event) => setFim(event.target.value)}
                required
                aria-label="Fim da janela"
                className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-jelly-500"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              {pending ? 'A guardar…' : 'Declarar'}
            </button>
          </div>

          {state.error && <p className="mt-2 text-sm text-jelly-600">{state.error}</p>}
          {state.message && <p className="mt-2 text-sm text-green-700">{state.message}</p>}
        </form>
      )}
    </div>
  )
}
