'use client'

import { useActionState } from 'react'
import { linkUmbrellaProjectAction, type ConnectorState } from '../../actions'

export interface UmbrellaOption {
  id: number
  name: string
  baseUrl: string
  connectivity: string | null
}

/**
 * Ligar — ou desligar — um site a um projeto da WP Umbrella.
 *
 * Vive nas definições do site, que é onde se configura um site. Esteve só na
 * página do WordPress, e essa página só aparece na navegação quando já há
 * ligação: para ligar era preciso estar ligado. A página do WordPress continua
 * a mostrar isto, para quem já lá está poder trocar ou desligar.
 *
 * A lista já só traz projetos deste hostname. Uma ligação antiga a outro
 * endereço continua visível no painel, mas não volta a ser aceite: o
 * servidor recusa-a.
 */
export function UmbrellaLink({
  siteId,
  linkedId,
  options,
  unavailable,
  hostname,
  totalProjects,
  similar = [],
  canManage,
}: {
  siteId: string
  linkedId: string | null
  options: UmbrellaOption[]
  unavailable?: string
  /** Para explicar uma lista vazia. Ver `similarProjects`. */
  hostname?: string
  totalProjects?: number
  similar?: { name: string; baseUrl: string }[]
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<ConnectorState, FormData>(
    linkUmbrellaProjectAction,
    {},
  )
  const ligadoAqui = options.some((option) => String(option.id) === linkedId)

  if (!canManage) {
    return (
      <p className="px-5 py-4 text-xs text-ink-400">
        {linkedId
          ? 'Este site está ligado à WP Umbrella.'
          : 'Este site não está ligado a nenhuma ferramenta de manutenção.'}
      </p>
    )
  }

  return (
    <form action={action} className="px-5 py-4">
      <input type="hidden" name="siteId" value={siteId} />

      <p className="text-xs text-ink-400">
        {linkedId
          ? 'Desligar pára a recolha e apaga o inventário. O histórico de atualizações fica.'
          : 'É a ligação que torna este site um site WordPress para o Jellycare: a partir daí há inventário de plugins e temas, cópias de segurança e atualizações automáticas.'}
      </p>

      {unavailable ? (
        <p className="mt-2 text-xs text-ink-400">
          Não foi possível obter a lista de projetos: {unavailable}
        </p>
      ) : (
        <>
          <label htmlFor="umbrella-project" className="mt-3 block text-xs text-ink-400">
            Projeto na WP Umbrella
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <select
              id="umbrella-project"
              name="projectId"
              defaultValue={ligadoAqui ? (linkedId ?? '') : ''}
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

          {options.length === 0 && hostname ? (
            <div className="mt-2 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600" data-umbrella-sem-projeto>
              <p>
                Nenhum dos {totalProjects ?? 0} projetos da WP Umbrella tem o endereço {hostname}. O projeto tem de
                estar lá registado com este endereço (com ou sem www).
              </p>
              {similar.length > 0 ? (
                <>
                  <p className="mt-1.5">Há projetos parecidos, registados com outro endereço:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {similar.map((projeto) => (
                      <li key={projeto.baseUrl}>
                        {projeto.name} — {projeto.baseUrl}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5">
                    Se for um destes, corrija o endereço na WP Umbrella, ou o deste site nas definições acima.
                  </p>
                </>
              ) : (
                <p className="mt-1.5">
                  Confirme na WP Umbrella que o site foi acrescentado e que o plugin está ligado. A lista é lida de
                  novo sempre que esta página abre.
                </p>
              )}
            </div>
          ) : null}

          <p className="mt-2 text-xs text-ink-400">
            {linkedId && !ligadoAqui
              ? 'A ligação atual é de outro endereço e não volta a ser aceite. Escolha o projeto deste site ou desligue.'
              : 'Confirme o endereço e não só o nome. Ligar ao projeto errado faz-nos reportar a este cliente as vulnerabilidades de outro.'}
          </p>
        </>
      )}

      {state.error ? <p className="mt-2 text-sm text-alarme">{state.error}</p> : null}
      {state.message ? <p className="mt-2 text-sm text-ink-600">{state.message}</p> : null}
    </form>
  )
}
