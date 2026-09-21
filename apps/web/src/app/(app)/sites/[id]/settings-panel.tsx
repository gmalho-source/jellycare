'use client'

import { useActionState, useState } from 'react'
import {
  deleteSiteAction,
  setSiteStateAction,
  updateSiteSettingsAction,
  type SiteSettingsState,
} from '../../actions'

/**
 * As definições de um site, depois de ele existir.
 *
 * Até aqui um site era imutável: criava-se e nunca mais se lhe tocava. Três
 * campos nem sequer eram configuráveis na criação — os destinatários do
 * relatório, o SLA e as janelas de manutenção —, o que fazia o relatório
 * mensal ser gerado e não ser entregue a ninguém.
 *
 * O URL não está aqui de propósito. Mudá-lo num site já verificado invalida a
 * prova de propriedade e faz o histórico de disponibilidade passar a medir
 * outra coisa.
 */
export function SettingsPanel({
  siteId,
  label,
  url,
  state,
  expectedContent,
  recipients,
  slaTarget,
}: {
  siteId: string
  label: string
  url: string
  state: string
  expectedContent: string | null
  recipients: string[]
  slaTarget: number
}) {
  const [saveState, save, saving] = useActionState<SiteSettingsState, FormData>(
    updateSiteSettingsAction,
    {},
  )
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
      <form action={save} className="space-y-4 px-5 py-4">
        <input type="hidden" name="siteId" value={siteId} />

        <div>
          <label htmlFor="site-label" className="block text-xs text-ink-500">
            Nome
          </label>
          <input
            id="site-label"
            name="label"
            defaultValue={label}
            required
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-ink-400">
            {url} — o endereço não se edita. Um domínio novo é um site novo: muda a prova de
            propriedade e o histórico passaria a medir outra coisa.
          </p>
        </div>

        <div>
          <label htmlFor="site-recipients" className="block text-xs text-ink-500">
            Destinatários do relatório mensal
          </label>
          <textarea
            id="site-recipients"
            name="recipients"
            rows={2}
            defaultValue={recipients.join('\n')}
            placeholder="cliente@empresa.pt"
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-ink-400">
            Um por linha, ou separados por vírgula. Vazio significa que o relatório é gerado e
            não é enviado a ninguém.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="site-expected" className="block text-xs text-ink-500">
              Conteúdo esperado na homepage
            </label>
            <input
              id="site-expected"
              name="expectedContent"
              defaultValue={expectedContent ?? ''}
              placeholder="o nome da empresa, por exemplo"
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
            />
          </div>

          <div className="w-32">
            <label htmlFor="site-sla" className="block text-xs text-ink-500">
              SLA (%)
            </label>
            <input
              id="site-sla"
              name="slaTarget"
              inputMode="decimal"
              defaultValue={String(slaTarget)}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-jelly-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-jelly-600 disabled:opacity-60"
          >
            {saving ? 'A guardar…' : 'Guardar'}
          </button>
          {saveState.error ? <span className="text-sm text-red-600">{saveState.error}</span> : null}
          {saveState.message ? (
            <span className="text-sm text-ink-600">{saveState.message}</span>
          ) : null}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 px-5 py-4">
        <form action={changeState}>
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="state" value={archived ? 'active' : 'archived'} />
          <button
            type="submit"
            disabled={changingState}
            className="rounded-lg border border-ink-200 px-3.5 py-2 text-sm text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-60"
          >
            {archived ? 'Reativar site' : 'Arquivar site'}
          </button>
        </form>

        <p className="flex-1 text-xs text-ink-400">
          {archived
            ? 'Arquivado: nada é verificado e o histórico está intacto.'
            : 'Arquivar pára as verificações sem apagar nada. É o que se faz quando um contrato acaba.'}
        </p>

        {!showDelete ? (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="rounded-lg px-2 py-1 text-xs text-ink-400 hover:text-red-600"
          >
            Apagar definitivamente
          </button>
        ) : null}

        {stateResult.error ? (
          <p className="w-full text-sm text-red-600">{stateResult.error}</p>
        ) : null}
        {stateResult.message ? (
          <p className="w-full text-sm text-ink-600">{stateResult.message}</p>
        ) : null}
      </div>

      {showDelete ? (
        <form action={remove} className="border-t border-ink-200 bg-jelly-50 px-5 py-4">
          <input type="hidden" name="siteId" value={siteId} />

          <p className="text-sm text-ink-900">
            Apagar <strong>{label}</strong> leva atrás todas as execuções, problemas,
            formulários, submissões, relatórios e inventário. Não há forma de voltar.
          </p>
          <p className="mt-1 text-xs text-ink-600">
            Só faz sentido quando um cliente pede que os dados dele desapareçam. Para acabar um
            contrato, arquive.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              name="confirmation"
              required
              placeholder={label}
              aria-label={`Escreva ${label} para confirmar`}
              className="min-w-[16rem] flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={deleting}
              className="rounded-lg bg-jelly-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-jelly-700 disabled:opacity-60"
            >
              {deleting ? 'A apagar…' : 'Apagar'}
            </button>
            <button
              type="button"
              onClick={() => setShowDelete(false)}
              className="text-sm text-ink-500 hover:text-ink-900"
            >
              Cancelar
            </button>
          </div>

          <p className="mt-2 text-xs text-ink-500">
            Escreva o nome do site exatamente para confirmar.
          </p>

          {deleteResult.error ? (
            <p className="mt-2 text-sm text-red-600">{deleteResult.error}</p>
          ) : null}
        </form>
      ) : null}
    </>
  )
}
