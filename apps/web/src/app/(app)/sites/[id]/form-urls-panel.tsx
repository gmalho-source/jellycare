'use client'

import { useActionState } from 'react'
import { setFormTestUrlsAction, type FormTestUrlsState } from '../../actions'

/**
 * As páginas onde o teste de formulários pode escrever.
 *
 * Uma caixa de texto com uma página por linha, e não três campos separados:
 * quem tem os endereços tem-nos numa lista, e colar uma lista é mais rápido
 * do que preencher três caixas. O limite é imposto na validação, que também é
 * quem recusa domínios de terceiros.
 *
 * Deliberadamente sem valor por omissão. Um site que ninguém configurou não
 * testa formulário nenhum, e o painel diz isso em vez de ficar calado.
 *
 * O limite chega por propriedade e não por importação: puxar `@jellycare/db`
 * para um componente cliente arrasta o `postgres.js` atrás, e o build do
 * dashboard rebenta em `node:crypto`. A validação vive do lado do servidor,
 * que é onde tem de estar de qualquer maneira.
 */
export function FormUrlsPanel({
  siteId,
  urls,
  maxUrls,
  suggestions,
  canManage,
}: {
  siteId: string
  urls: string[]
  maxUrls: number
  /** Páginas onde a descoberta encontrou formulários, para não ser preciso adivinhar. */
  suggestions: string[]
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<FormTestUrlsState, FormData>(
    setFormTestUrlsAction,
    {},
  )

  const porDeclarar = suggestions.filter((page) => !urls.includes(page))

  if (!canManage) {
    return (
      <div className="border-t border-ink-100 px-5 py-4 text-sm text-ink-600">
        {urls.length === 0
          ? 'Nenhuma página declarada para teste de formulários.'
          : `${urls.length} ${urls.length === 1 ? 'página declarada' : 'páginas declaradas'}.`}
      </div>
    )
  }

  return (
    <form action={action} className="border-t border-ink-100 px-5 py-4">
      <input type="hidden" name="siteId" value={siteId} />

      <label htmlFor="form-urls" className="block text-xs text-ink-400">
        Páginas a testar — uma por linha, até {maxUrls}
      </label>
      <textarea
        id="form-urls"
        name="urls"
        rows={3}
        defaultValue={urls.join('\n')}
        placeholder={'/contactos\n/pedido-de-orcamento'}
        className="mt-1.5 w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-xs outline-none focus:border-jelly-500"
      />

      <p className="mt-2 text-xs text-ink-400">
        Só os formulários que vivem nestas páginas são preenchidos e enviados. Sem nenhuma
        página declarada, o teste de formulários não corre. Declarar restringe onde mexemos:
        formulários de entrada, registo ou compra continuam a nunca ser submetidos.
      </p>

      {porDeclarar.length > 0 ? (
        <p className="mt-2 text-xs text-ink-400">
          A descoberta encontrou formulários em{' '}
          {porDeclarar.map((page, index) => (
            <span key={page}>
              {index > 0 ? ', ' : ''}
              <code className="text-ink-600">{pathOf(page)}</code>
            </span>
          ))}
          .
        </p>
      ) : null}

      <div className="mt-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:opacity-60"
        >
          {pending ? 'A guardar…' : 'Guardar'}
        </button>
      </div>

      {state.error ? <p className="mt-2 text-sm text-red-600">{state.error}</p> : null}
      {state.message ? <p className="mt-2 text-sm text-ink-600">{state.message}</p> : null}

      {state.rejected?.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-red-600">
          {state.rejected.map((item) => (
            <li key={item.input}>
              <code>{item.input}</code> — {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  )
}

function pathOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).pathname
  } catch {
    return pageUrl
  }
}
