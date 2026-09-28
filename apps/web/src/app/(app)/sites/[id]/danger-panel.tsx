'use client'

import { useActionState, useState } from 'react'
import {
  deleteSiteAction,
  setSiteStateAction,
  type SiteSettingsState,
} from '../../actions'

/**
 * Arquivar e apagar um site.
 *
 * Vive num cartão próprio e não no rodapé das definições. Estava lá, e o
 * botão de apagar era texto cinzento de doze pixels encostado à direita de um
 * parágrafo — do tamanho de uma legenda, ao lado de coisas que se leem e não
 * se clicam. Quem foi à procura de apagar um site não o encontrou, que é o
 * mesmo que a funcionalidade não existir.
 *
 * Sair do rodapé não quer dizer chamar a atenção. As duas ações continuam
 * discretas e a destrutiva continua fechada atrás de escrever o nome à mão: o
 * problema era estar escondida, não estar contida.
 */
export function DangerPanel({
  siteId,
  label,
  state,
}: {
  siteId: string
  label: string
  state: string
}) {
  const [stateResult, changeState, changingState] = useActionState<SiteSettingsState, FormData>(
    setSiteStateAction,
    {},
  )
  const [deleteResult, remove, deleting] = useActionState<SiteSettingsState, FormData>(
    deleteSiteAction,
    {},
  )
  const [showDelete, setShowDelete] = useState(false)

  const archived = state === 'archived'

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
        <div className="min-w-[16rem] flex-1">
          <p className="text-sm font-medium text-ink-900">
            {archived ? 'Reativar site' : 'Arquivar site'}
          </p>
          <p className="mt-0.5 text-xs text-ink-400">
            {archived
              ? 'Neste momento nada é verificado e o histórico está intacto. Reativar recomeça as verificações no próximo ciclo.'
              : 'Pára as verificações sem apagar nada. É o que se faz quando um contrato acaba.'}
          </p>
        </div>

        <form action={changeState}>
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="state" value={archived ? 'active' : 'archived'} />
          <button
            type="submit"
            disabled={changingState}
            className="inline-flex min-h-11 items-center rounded-xl border border-ink-200 px-4 text-sm font-medium text-ink-900 hover:bg-ink-100 disabled:opacity-60"
          >
            {archived ? 'Reativar site' : 'Arquivar site'}
          </button>
        </form>

        {stateResult.error ? (
          <p className="w-full text-sm text-alarme">{stateResult.error}</p>
        ) : null}
        {stateResult.message ? (
          <p className="w-full text-sm text-ink-600">{stateResult.message}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-ink-100 px-5 py-4">
        <div className="min-w-[16rem] flex-1">
          <p className="text-sm font-medium text-ink-900">Apagar site</p>
          <p className="mt-0.5 text-xs text-ink-400">
            Leva atrás execuções, problemas, formulários, submissões, relatórios e inventário.
            Não há forma de voltar. Só faz sentido quando um cliente pede que os dados dele
            desapareçam.
          </p>
        </div>

        {!showDelete ? (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="inline-flex min-h-11 items-center rounded-xl border border-alarme/40 px-4 text-sm font-medium text-alarme hover:bg-alarme/5"
          >
            Apagar site
          </button>
        ) : null}
      </div>

      {showDelete ? (
        <form action={remove} className="border-t border-ink-100 bg-jelly-50 px-5 py-4">
          <input type="hidden" name="siteId" value={siteId} />

          <p className="text-sm text-ink-900">
            Escreva <strong>{label}</strong> para confirmar que é mesmo este site.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              name="confirmation"
              required
              autoComplete="off"
              placeholder={label}
              aria-label={`Escreva ${label} para confirmar`}
              className="min-w-[16rem] flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={deleting}
              className="inline-flex min-h-11 items-center rounded-xl bg-alarme px-4 text-sm font-semibold text-white hover:bg-mau disabled:opacity-60"
            >
              {deleting ? 'A apagar…' : 'Apagar para sempre'}
            </button>
            <button
              type="button"
              onClick={() => setShowDelete(false)}
              className="text-sm text-ink-400 hover:text-ink-900"
            >
              Cancelar
            </button>
          </div>

          {deleteResult.error ? (
            <p className="mt-2 text-sm text-alarme">{deleteResult.error}</p>
          ) : null}
        </form>
      ) : null}
    </>
  )
}
