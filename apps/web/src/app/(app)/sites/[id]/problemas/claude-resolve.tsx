'use client'

import { useActionState } from 'react'
import {
  definirRepositorioAction,
  pedirAoClaudeAction,
  type EstadoClaudeResolve,
} from './claude-resolve-actions'

const BOTAO = 'rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-60'

/**
 * O botão «Claude Resolve» de um problema.
 *
 * Abre uma issue no repositório do site, e o Claude Code prepara a correção
 * num pull request. Depois de enviado, o botão dá lugar à ligação para a
 * issue: o trabalho segue no GitHub, e o problema fecha sozinho quando a
 * verificação seguinte o deixar de ver.
 */
export function BotaoClaudeResolve({ findingId }: { findingId: string }) {
  const [estado, acao, aEnviar] = useActionState<EstadoClaudeResolve, FormData>(pedirAoClaudeAction, {})

  if (estado.issueUrl) {
    return (
      <a href={estado.issueUrl} target="_blank" rel="noreferrer" className={`${BOTAO} text-ink-900`}>
        {estado.message}
      </a>
    )
  }

  return (
    <form action={acao} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="findingId" value={findingId} />
      <button
        type="submit"
        disabled={aEnviar}
        className={BOTAO}
        title="Abre uma issue no repositório do site; o Claude prepara a correção num pull request, que alguém da equipa revê e aplica"
      >
        {aEnviar ? 'A enviar…' : 'Claude Resolve'}
      </button>
      {estado.error ? (
        <span className="text-xs font-medium text-mau" role="alert">
          {estado.error}
        </span>
      ) : null}
    </form>
  )
}

/** O repositório do site no GitHub, nas definições. */
export function RepositorioDoSite({
  siteId,
  repo,
  configurado,
}: {
  siteId: string
  repo: string | null
  configurado: boolean
}) {
  const [estado, acao, aEnviar] = useActionState<EstadoClaudeResolve, FormData>(definirRepositorioAction, {})

  return (
    <form action={acao} className="space-y-3 px-5 py-4">
      <input type="hidden" name="siteId" value={siteId} />
      <label className="block text-sm font-medium text-ink-900">
        Repositório no GitHub
        <input
          name="repo"
          defaultValue={repo ?? ''}
          placeholder="jelly-pt/site-cliente"
          className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-jelly-500 focus:ring-2 focus:ring-jelly-100"
        />
      </label>
      <p className="text-xs text-ink-400">
        Um repositório por site, criado a partir do repositório-modelo. Com ele ligado, os problemas de cabeçalhos,
        email e WordPress ganham o botão «Claude Resolve».
        {configurado ? '' : ' Falta ainda o GITHUB_RESOLVE_TOKEN nos segredos do dashboard.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={aEnviar}
          className="inline-flex min-h-10 items-center rounded-xl border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-ink-50 disabled:opacity-60"
        >
          {aEnviar ? 'A guardar…' : 'Guardar'}
        </button>
        {estado.error ? <span className="text-sm font-medium text-mau">{estado.error}</span> : null}
        {estado.message ? <span className="text-sm text-bom">{estado.message}</span> : null}
      </div>
    </form>
  )
}
