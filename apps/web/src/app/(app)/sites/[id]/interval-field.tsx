'use client'

import { useActionState } from 'react'
import { setCheckIntervalAction, type ActionState } from '../../actions'

/**
 * A periodicidade de uma verificação, editável na própria linha.
 *
 * Painel próprio para isto era um ecrã a mais para uma coisa que só se muda
 * em dois ou três sites da carteira. Aqui, quem está a olhar para a lista
 * muda o número onde ele já está escrito.
 */
const OPCOES = [
  { minutos: 5, label: '5 min' },
  { minutos: 15, label: '15 min' },
  { minutos: 60, label: '1 hora' },
  { minutos: 60 * 6, label: '6 horas' },
  { minutos: 60 * 24, label: '1 dia' },
  { minutos: 60 * 24 * 7, label: '1 semana' },
]

export function IntervalField({
  checkConfigId,
  intervalMinutes,
}: {
  checkConfigId: string
  intervalMinutes: number
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setCheckIntervalAction,
    {},
  )

  // Uma periodicidade fora da lista — posta à mão ou vinda de outro tempo —
  // não desaparece do seletor só por não ser redonda.
  const opcoes = OPCOES.some((opcao) => opcao.minutos === intervalMinutes)
    ? OPCOES
    : [...OPCOES, { minutos: intervalMinutes, label: `${intervalMinutes} min` }].sort(
        (a, b) => a.minutos - b.minutos,
      )

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="checkConfigId" value={checkConfigId} />
      <select
        name="intervalMinutes"
        defaultValue={intervalMinutes}
        disabled={pending}
        aria-label="Periodicidade"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-ink-200 bg-white px-1.5 py-0.5 text-xs text-ink-600 outline-none focus:border-jelly-500 disabled:opacity-50"
      >
        {opcoes.map((opcao) => (
          <option key={opcao.minutos} value={opcao.minutos}>
            {opcao.label}
          </option>
        ))}
      </select>
      {state.error && <span className="text-xs text-mau">{state.error}</span>}
      {/* Sem isto, mudar o valor não dava sinal nenhum de ter sido guardado —
          o seletor mostrava a escolha nova quer ela tivesse sido gravada ou
          não. */}
      {state.message && !state.error && (
        <span className="text-xs text-green-700">Periodicidade alterada</span>
      )}
    </form>
  )
}
