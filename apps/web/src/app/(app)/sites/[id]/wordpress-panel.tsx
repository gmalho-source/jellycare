'use client'

import { formatRelative } from '@/components/ui'
import { UmbrellaLink, type UmbrellaOption } from './umbrella-link'

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
 * O inventário recolhido, e por baixo dele o seletor da ligação — o mesmo que
 * vive nas definições do site, onde a ligação se cria. Aqui serve para trocar
 * de projeto ou desligar sem sair de onde se está a ver o estrago.
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

      <div className="border-t border-ink-100">
        <UmbrellaLink
          siteId={siteId}
          linkedId={linked?.externalId ?? null}
          options={options}
          {...(unavailable ? { unavailable } : {})}
          canManage={canManage}
        />
      </div>
    </>
  )
}
