'use client'

import { useActionState } from 'react'
import { formatRelative } from '@/components/ui'
import { linkUmbrellaProjectAction, type ConnectorState } from '../../actions'

export interface UmbrellaOption {
  id: number
  name: string
  baseUrl: string
  connectivity: string | null
}

export interface WordPressComponent {
  kind: string
  key: string
  name: string
  version: string | null
  latestVersion: string | null
  active: boolean
}

/**
 * Profundidade WordPress, pela WP Umbrella.
 *
 * A ligação é escolhida à mão e não emparelhada por hostname: ligar o site
 * errado faz-nos reportar as vulnerabilidades de um cliente a outro, e um
 * endereço parecido chega para isso acontecer. Daí a lista mostrar o endereço
 * de cada projeto ao lado do nome.
 */
export function WordPressPanel({
  siteId,
  linked,
  lastSyncAt,
  lastError,
  options,
  unavailable,
  components,
  canManage,
}: {
  siteId: string
  linked: { externalId: string; externalName: string | null } | null
  lastSyncAt: Date | null
  lastError: string | null
  options: UmbrellaOption[]
  unavailable?: string
  components: WordPressComponent[]
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<ConnectorState, FormData>(
    linkUmbrellaProjectAction,
    {},
  )

  const porAtualizar = components.filter((c) => c.latestVersion !== null)

  return (
    <>
      {linked ? (
        <div className="border-b border-ink-100 px-5 py-3 text-xs">
          {lastError ? (
            <p className="text-red-600">Última recolha falhou: {lastError}</p>
          ) : lastSyncAt ? (
            <p className="text-ink-400">
              {components.length} componentes, {porAtualizar.length} por atualizar. Recolhido{' '}
              {formatRelative(lastSyncAt)}.
            </p>
          ) : (
            <p className="text-ink-400">Ligado. Ainda não houve recolha.</p>
          )}
        </div>
      ) : null}

      {components.length > 0 ? (
        <ul className="divide-y divide-ink-100">
          {[...components]
            // O que precisa de ação primeiro. Dentro de cada grupo, por nome,
            // para a lista não saltar entre recolhas.
            .sort((a, b) => {
              const porA = a.latestVersion ? 0 : 1
              const porB = b.latestVersion ? 0 : 1
              return porA !== porB ? porA - porB : a.name.localeCompare(b.name, 'pt')
            })
            .map((component) => (
              <li
                key={`${component.kind}:${component.key}`}
                className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
              >
                <span className="min-w-0 truncate text-ink-900">
                  {component.name}
                  {component.kind === 'theme' ? (
                    <span className="ml-1.5 text-xs text-ink-400">tema</span>
                  ) : null}
                  {/* Sem isto o core aparecia nesta lista como se fosse mais
                      um plugin chamado «WordPress». */}
                  {component.kind === 'core' ? (
                    <span className="ml-1.5 text-xs text-ink-400">core</span>
                  ) : null}
                  {!component.active ? (
                    <span className="ml-1.5 text-xs text-ink-400">inativo</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs">
                  {component.latestVersion ? (
                    <span className="text-jelly-600">
                      {component.version ?? '?'} → {component.latestVersion}
                    </span>
                  ) : (
                    <span className="text-ink-400">{component.version ?? '—'}</span>
                  )}
                </span>
              </li>
            ))}
        </ul>
      ) : null}

      {canManage ? (
        <form action={action} className="border-t border-ink-100 px-5 py-4">
          <input type="hidden" name="siteId" value={siteId} />

          {unavailable ? (
            <p className="text-xs text-ink-400">
              Não foi possível obter a lista de projetos: {unavailable}
            </p>
          ) : (
            <>
              <label htmlFor="umbrella-project" className="block text-xs text-ink-400">
                Projeto na WP Umbrella
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <select
                  id="umbrella-project"
                  name="projectId"
                  defaultValue={linked?.externalId ?? ''}
                  className="min-w-[18rem] flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
                >
                  <option value="">Não ligado</option>
                  {options.map((option) => (
                    <option key={option.id} value={String(option.id)}>
                      {option.name} — {option.baseUrl}
                      {option.connectivity !== 'paired' ? ' (plugin sem resposta)' : ''}
                    </option>
                  ))}
                </select>

                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:opacity-60"
                >
                  {pending ? 'A guardar…' : 'Guardar'}
                </button>
              </div>

              <p className="mt-2 text-xs text-ink-400">
                Confirme o endereço e não só o nome. Ligar ao projeto errado faz-nos reportar a
                este cliente as vulnerabilidades de outro.
              </p>
            </>
          )}

          {state.error ? <p className="mt-2 text-sm text-red-600">{state.error}</p> : null}
          {state.message ? <p className="mt-2 text-sm text-ink-600">{state.message}</p> : null}
        </form>
      ) : null}
    </>
  )
}
