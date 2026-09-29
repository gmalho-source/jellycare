'use client'

import { useActionState, useRef, useEffect } from 'react'
import { formatRelative, nomeDoMes } from '@/components/ui'
import type { NotaDoRelatorio } from '@/lib/relatorio-conteudo'
import {
  addReportNoteAction,
  archiveReportNoteAction,
  setReportSectionsAction,
  type ReportContentState,
} from '../../../actions'

function Estado({ state }: { state: ReportContentState }) {
  if (state.error) return <p className="text-sm text-alarme">{state.error}</p>
  if (state.message) return <p className="text-sm text-ink-600">{state.message}</p>
  return null
}

/**
 * Os módulos que entram no relatório deste site.
 *
 * Todos marcados por omissão: tirar é a exceção, para o cliente a quem um
 * módulo não diz nada, e não uma configuração que cada site novo tem de fazer.
 */
export function ModulosDoRelatorio({
  siteId,
  modulos,
  excluidas,
  temWordPress,
}: {
  siteId: string
  /**
   * A lista de `@jellycare/reports`, vinda da página. Não se importa aqui: o
   * pacote puxa módulos do Node que não entram no bundle do browser.
   */
  modulos: readonly { key: string; label: string; description: string }[]
  excluidas: string[]
  /** Sem ligação à WP Umbrella o módulo não tem dados, marcado ou não. */
  temWordPress: boolean
}) {
  const [state, action, pending] = useActionState<ReportContentState, FormData>(
    setReportSectionsAction,
    {},
  )
  const fora = new Set(excluidas)

  return (
    <form action={action} className="px-5 py-4">
      <input type="hidden" name="siteId" value={siteId} />
      <ul className="space-y-3">
        {modulos.map((section) => (
          <li key={section.key}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="section"
                value={section.key}
                defaultChecked={!fora.has(section.key)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-900">{section.label}</span>
                <span className="block text-xs text-ink-400">
                  {section.description}
                  {section.key === 'wordpress' && !temWordPress
                    ? ' Este site não está ligado à WP Umbrella, por isso o módulo não aparece.'
                    : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-10 items-center rounded-lg bg-ink-900 px-3.5 text-sm font-medium text-white hover:bg-ink-900/90 disabled:opacity-60"
        >
          {pending ? 'A guardar…' : 'Guardar módulos'}
        </button>
        <Estado state={state} />
      </div>
      <p className="mt-2 text-xs text-ink-400">
        O resumo entra sempre, e acompanha o que fica: tirar um módulo tira também o que o
        resumo diria sobre ele.
      </p>
    </form>
  )
}

function Modo({ mode }: { mode: NotaDoRelatorio['mode'] }) {
  return mode === 'persistent' ? (
    <span className="rounded-full bg-jelly-50 px-2 py-0.5 text-[0.6875rem] font-medium text-jelly-700">
      Em todos os relatórios
    </span>
  ) : (
    <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[0.6875rem] font-medium text-ink-600">
      Só no próximo
    </span>
  )
}

function Autoria({ nota }: { nota: NotaDoRelatorio }) {
  return (
    <span className="text-xs text-ink-400">
      {nota.createdByEmail ?? 'Alguém que já não tem conta'} · {formatRelative(nota.createdAt)}
    </span>
  )
}

/**
 * As notas da equipa: as que seguem no próximo relatório, uma nova, e as que
 * já seguiram.
 *
 * O formulário da nota nova está sempre lá, haja as notas que houver. Era esse
 * o ponto: uma nota persistente não pode ocupar o lugar de uma nota sobre o
 * mês.
 */
export function NotasDaEquipa({
  siteId,
  ativas,
  anteriores,
}: {
  siteId: string
  ativas: NotaDoRelatorio[]
  anteriores: NotaDoRelatorio[]
}) {
  const [state, action, pending] = useActionState<ReportContentState, FormData>(
    addReportNoteAction,
    {},
  )
  const formulario = useRef<HTMLFormElement>(null)

  // Limpa a caixa depois de gravar. Sem isto, a nota acabada de acrescentar
  // aparecia na lista e continuava escrita no campo, a convidar um segundo
  // clique que a duplicava.
  useEffect(() => {
    if (state.message) formulario.current?.reset()
  }, [state])

  return (
    <div>
      {ativas.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-400">
          O próximo relatório não leva notas da equipa.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100" aria-label="Notas no próximo relatório">
          {ativas.map((nota) => (
            <li key={nota.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Modo mode={nota.mode} />
                  <Autoria nota={nota} />
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-900">{nota.body}</p>
              </div>
              <form action={archiveReportNoteAction} className="shrink-0">
                <input type="hidden" name="noteId" value={nota.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
                >
                  Retirar
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form ref={formulario} action={action} className="border-t border-ink-100 px-5 py-4">
        <input type="hidden" name="siteId" value={siteId} />
        <label htmlFor="report-note" className="block text-xs text-ink-400">
          Nova nota
        </label>
        <textarea
          id="report-note"
          name="body"
          rows={3}
          maxLength={4000}
          placeholder="O que a equipa quer dizer ao cliente neste relatório…"
          className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
        />

        <fieldset className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <legend className="sr-only">Quando segue</legend>
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input type="radio" name="mode" value="next_only" defaultChecked />
            Só no próximo relatório
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input type="radio" name="mode" value="persistent" />
            Em todos os relatórios, até ser retirada
          </label>
        </fieldset>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-10 items-center rounded-lg bg-ink-900 px-3.5 text-sm font-medium text-white hover:bg-ink-900/90 disabled:opacity-60"
          >
            {pending ? 'A acrescentar…' : 'Acrescentar nota'}
          </button>
          <Estado state={state} />
        </div>
        <p className="mt-2 text-xs text-ink-400">
          As notas aparecem logo a seguir ao resumo, pela ordem em que foram escritas, com o
          título «Nota da equipa». O cliente lê-as tal como ficam aqui.
        </p>
      </form>

      {anteriores.length > 0 ? (
        <details className="border-t border-ink-100 px-5 py-4">
          <summary className="cursor-pointer text-xs font-medium text-ink-600">
            Notas anteriores ({anteriores.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {anteriores.map((nota) => (
              <li key={nota.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Modo mode={nota.mode} />
                  <span className="text-xs text-ink-400">
                    {nota.enviadaEm
                      ? `Seguiu no relatório de ${nomeDoMes(nota.enviadaEm.periodMonth)} de ${nota.enviadaEm.periodYear}`
                      : `Retirada ${formatRelative(nota.archivedAt ?? nota.createdAt)}`}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-600">{nota.body}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
