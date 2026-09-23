'use client'

import { useActionState, useState } from 'react'
import { setMaintenanceScheduleAction, type ActionState } from '../../actions'

/**
 * O horário de manutenção que se repete.
 *
 * As janelas avulsas continuam a servir o trabalho planeado de uma noite. Isto
 * é o que faz a manutenção automática ser automática: sem um horário, alguém
 * teria de declarar uma data de cada vez, que é o contrário.
 *
 * O fuso é escolhido e não deduzido do browser. Quem gere os sites a partir do
 * Dubai não quer necessariamente a manutenção às três da manhã do Dubai — quer
 * à hora a que o site do cliente tem menos visitas.
 */

const DIAS = [
  { valor: 1, label: 'seg' },
  { valor: 2, label: 'ter' },
  { valor: 3, label: 'qua' },
  { valor: 4, label: 'qui' },
  { valor: 5, label: 'sex' },
  { valor: 6, label: 'sáb' },
  { valor: 0, label: 'dom' },
]

const FUSOS = ['Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Asia/Dubai', 'UTC']

const DURACOES = [
  { minutos: 60, label: '1 hora' },
  { minutos: 120, label: '2 horas' },
  { minutos: 180, label: '3 horas' },
  { minutos: 360, label: '6 horas' },
]

export interface Horario {
  weekdays: number[]
  hour: number
  minute: number
  durationMinutes: number
  timezone: string
}

function descrever(horario: Horario): string {
  const dias =
    horario.weekdays.length === 0
      ? 'todos os dias'
      : DIAS.filter((dia) => horario.weekdays.includes(dia.valor))
          .map((dia) => dia.label)
          .join(', ')
  const hora = `${String(horario.hour).padStart(2, '0')}:${String(horario.minute).padStart(2, '0')}`
  const duracao =
    horario.durationMinutes % 60 === 0
      ? `${horario.durationMinutes / 60}h`
      : `${horario.durationMinutes} min`

  return `${dias}, às ${hora} (${horario.timezone}), durante ${duracao}`
}

export function ScheduleField({
  siteId,
  schedule,
  canManage,
}: {
  siteId: string
  schedule: Horario | null
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setMaintenanceScheduleAction,
    {},
  )
  const [aberto, setAberto] = useState(false)

  return (
    <div className="border-t border-ink-100 pt-3">
      <p className="text-xs font-medium text-ink-600">Horário recorrente</p>

      {schedule ? (
        <p className="mt-1 text-sm text-ink-900">{descrever(schedule)}</p>
      ) : (
        <p className="mt-1 text-sm text-ink-400">
          Sem horário. A manutenção automática só corre dentro de uma janela declarada.
        </p>
      )}

      {canManage && !aberto && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="text-xs font-medium text-ink-900 underline underline-offset-2"
          >
            {schedule ? 'Alterar' : 'Definir horário'}
          </button>
          {schedule && (
            <form action={action}>
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="operacao" value="limpar" />
              <button
                type="submit"
                className="text-xs text-ink-400 underline underline-offset-2 hover:text-ink-600"
              >
                Remover
              </button>
            </form>
          )}
        </div>
      )}

      {canManage && aberto && (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="siteId" value={siteId} />

          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((dia) => (
              <label
                key={dia.valor}
                className="flex cursor-pointer items-center gap-1 rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-600 has-checked:border-jelly-500 has-checked:bg-jelly-50"
              >
                <input
                  type="checkbox"
                  name="weekday"
                  value={dia.valor}
                  defaultChecked={schedule?.weekdays.includes(dia.valor)}
                  className="h-3 w-3"
                />
                {dia.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-400">Nenhum dia marcado significa todos os dias.</p>

          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="block text-xs text-ink-600">Hora</span>
              <input
                type="number"
                name="hour"
                min={0}
                max={23}
                defaultValue={schedule?.hour ?? 3}
                required
                className="mt-1 w-16 rounded-lg border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-jelly-500"
              />
            </label>
            <label>
              <span className="block text-xs text-ink-600">Minutos</span>
              <input
                type="number"
                name="minute"
                min={0}
                max={59}
                step={5}
                defaultValue={schedule?.minute ?? 0}
                className="mt-1 w-16 rounded-lg border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-jelly-500"
              />
            </label>
            <label>
              <span className="block text-xs text-ink-600">Durante</span>
              <select
                name="durationMinutes"
                defaultValue={schedule?.durationMinutes ?? 120}
                className="mt-1 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-jelly-500"
              >
                {DURACOES.map((duracao) => (
                  <option key={duracao.minutos} value={duracao.minutos}>
                    {duracao.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="block text-xs text-ink-600">Fuso</span>
              <select
                name="timezone"
                defaultValue={schedule?.timezone ?? 'Europe/Lisbon'}
                className="mt-1 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-jelly-500"
              >
                {FUSOS.map((fuso) => (
                  <option key={fuso} value={fuso}>
                    {fuso}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              {pending ? 'A guardar…' : 'Guardar horário'}
            </button>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-xs text-ink-400 underline underline-offset-2"
            >
              Cancelar
            </button>
            {state.error && <span className="text-sm text-mau">{state.error}</span>}
            {state.message && <span className="text-sm text-green-700">{state.message}</span>}
          </div>
        </form>
      )}

      {!aberto && state.message && (
        <p className="mt-2 text-sm text-green-700">{state.message}</p>
      )}
    </div>
  )
}
