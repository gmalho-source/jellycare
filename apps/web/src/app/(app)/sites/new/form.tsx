'use client'

import { useActionState } from 'react'
import { createSite, type ActionState } from '../../actions'

const inputClass =
  'mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-jelly-500 focus:ring-2 focus:ring-jelly-100'

export function NewSiteForm({
  organizations,
}: {
  organizations: { id: string; name: string }[]
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSite, {})

  return (
    <form action={action} className="space-y-5 rounded-2xl bg-white shadow-card p-6">
      {organizations.length > 1 && (
        <div>
          <label htmlFor="organizationId" className="text-sm font-medium text-ink-900">
            Cliente
          </label>
          <select id="organizationId" name="organizationId" className={inputClass} required>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {organizations.length === 1 && (
        <input type="hidden" name="organizationId" value={organizations[0]!.id} />
      )}

      <div>
        <label htmlFor="label" className="text-sm font-medium text-ink-900">
          Nome
        </label>
        <input
          id="label"
          name="label"
          className={inputClass}
          placeholder="Site institucional"
          required
        />
      </div>

      <div>
        <label htmlFor="url" className="text-sm font-medium text-ink-900">
          Endereço
        </label>
        <input
          id="url"
          name="url"
          className={inputClass}
          placeholder="cliente.pt"
          required
          autoComplete="off"
        />
        <p className="mt-1.5 text-xs text-ink-400">
          Sem protocolo assume-se https. Guardamos o endereço canónico do site.
        </p>
      </div>

      <div>
        <label htmlFor="expectedContent" className="text-sm font-medium text-ink-900">
          Texto que tem de estar na página inicial
        </label>
        <input
          id="expectedContent"
          name="expectedContent"
          className={inputClass}
          placeholder="Nome da empresa, por exemplo"
        />
        <p className="mt-1.5 text-xs text-ink-400">
          Opcional, mas recomendado: um site comprometido ou com a base de dados em baixo responde
          200 na mesma. Sem isto, não distinguimos uma página branca de um site saudável.
        </p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink-900">
          Como quer provar a propriedade do domínio?
        </legend>
        <div className="mt-2 space-y-2">
          <label className="flex items-start gap-2.5 rounded-lg border border-ink-200 p-3 text-sm">
            <input type="radio" name="method" value="dns_txt" defaultChecked className="mt-0.5" />
            <span>
              <span className="font-medium">Registo DNS TXT</span>
              <span className="mt-0.5 block text-xs text-ink-400">
                Prova a propriedade do domínio inteiro e não depende do site estar de pé.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-ink-200 p-3 text-sm">
            <input type="radio" name="method" value="http_file" className="mt-0.5" />
            <span>
              <span className="font-medium">Ficheiro no servidor</span>
              <span className="mt-0.5 block text-xs text-ink-400">
                Mais rápido quando não há acesso ao DNS. Confirma em segundos.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {state.error && (
        <p className="sev-critical rounded-xl px-3.5 py-2.5 text-sm font-medium">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:opacity-50"
      >
        {pending ? 'A criar…' : 'Criar site'}
      </button>
    </form>
  )
}
