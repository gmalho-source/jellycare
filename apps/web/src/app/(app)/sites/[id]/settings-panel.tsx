'use client'

import { useActionState } from 'react'
import { updateSiteSettingsAction, type SiteSettingsState } from '../../actions'

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
 *
 * Arquivar e apagar saíram daqui para o cartão ao lado: são ações sobre a
 * existência do site e não campos dele, e ficavam a competir com o botão de
 * guardar.
 */
export function SettingsPanel({
  siteId,
  label,
  url,
  expectedContent,
  recipients,
  slaTarget,
}: {
  siteId: string
  label: string
  url: string
  expectedContent: string | null
  recipients: string[]
  slaTarget: number
}) {
  const [saveState, save, saving] = useActionState<SiteSettingsState, FormData>(
    updateSiteSettingsAction,
    {},
  )

  return (
    <form action={save} className="space-y-4 px-5 py-4">
      <input type="hidden" name="siteId" value={siteId} />

      <div>
        <label htmlFor="site-label" className="block text-xs text-ink-400">
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
        <label htmlFor="site-recipients" className="block text-xs text-ink-400">
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
          <label htmlFor="site-expected" className="block text-xs text-ink-400">
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
          <label htmlFor="site-sla" className="block text-xs text-ink-400">
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
          className="inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:opacity-60"
        >
          {saving ? 'A guardar…' : 'Guardar'}
        </button>
        {saveState.error ? <span className="text-sm text-alarme">{saveState.error}</span> : null}
        {saveState.message ? (
          <span className="text-sm text-ink-600">{saveState.message}</span>
        ) : null}
      </div>
    </form>
  )
}
