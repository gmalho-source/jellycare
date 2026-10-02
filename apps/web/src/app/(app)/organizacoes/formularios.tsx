'use client'

import { startTransition, useActionState } from 'react'
import type { ContactoDaOrganizacao } from '@jellycare/db'
import {
  acrescentarEquipaAction,
  criarOrganizacaoAction,
  guardarContactoAction,
  moverSiteAction,
  renomearOrganizacaoAction,
  retirarEquipaAction,
  type EstadoDoFormulario,
} from './actions'

const inputClass =
  'mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-jelly-500 focus:ring-2 focus:ring-jelly-100'
const botaoPrincipal =
  'inline-flex min-h-10 items-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:opacity-60'
const botaoSecundario =
  'inline-flex min-h-10 items-center rounded-xl border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-ink-50 disabled:opacity-60'

function Resposta({ estado }: { estado: EstadoDoFormulario }) {
  if (estado.error) return <p className="text-sm font-medium text-mau" role="alert">{estado.error}</p>
  if (estado.message) return <p className="text-sm text-bom" role="status">{estado.message}</p>
  return null
}

export function NovaOrganizacao() {
  const [estado, acao, aEnviar] = useActionState<EstadoDoFormulario, FormData>(criarOrganizacaoAction, {})
  return (
    <form action={acao} className="flex flex-wrap items-end gap-3 px-5 py-4">
      <label className="min-w-0 flex-1 text-sm font-medium text-ink-900">
        Nome do cliente
        <input name="name" required maxLength={120} placeholder="Clínica Sorriso" className={inputClass} />
      </label>
      <button type="submit" disabled={aEnviar} className={botaoPrincipal}>
        {aEnviar ? 'A criar…' : 'Criar organização'}
      </button>
      <div className="w-full">
        <Resposta estado={estado} />
      </div>
    </form>
  )
}

export function RenomearOrganizacao({ organizationId, nome }: { organizationId: string; nome: string }) {
  const [estado, acao, aEnviar] = useActionState<EstadoDoFormulario, FormData>(renomearOrganizacaoAction, {})
  return (
    <form action={acao} className="flex flex-wrap items-end gap-3 px-5 py-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <label className="min-w-0 flex-1 text-sm font-medium text-ink-900">
        Nome
        <input name="name" required maxLength={120} defaultValue={nome} className={inputClass} />
      </label>
      <button type="submit" disabled={aEnviar} className={botaoSecundario}>
        {aEnviar ? 'A guardar…' : 'Guardar'}
      </button>
      <div className="w-full">
        <Resposta estado={estado} />
      </div>
    </form>
  )
}

/**
 * Um contacto, novo ou já existente.
 *
 * O mesmo formulário para os dois casos: um contacto que se edita é um
 * contacto que se acrescenta com os campos já preenchidos.
 */
export function FormularioContacto({
  organizationId,
  contacto,
}: {
  organizationId: string
  contacto?: ContactoDaOrganizacao
}) {
  const [estado, acao, aEnviar] = useActionState<EstadoDoFormulario, FormData>(guardarContactoAction, {})
  const prefixo = contacto ? `contacto-${contacto.id}` : 'contacto-novo'

  return (
    <form
      // Enviado à mão e não pelo `action` do formulário: com `action`, o
      // React limpa os campos no fim de cada envio, também quando a resposta
      // é um erro, e quem escreveu seis campos perdia-os por causa de um.
      onSubmit={(evento) => {
        evento.preventDefault()
        const dados = new FormData(evento.currentTarget)
        startTransition(() => acao(dados))
      }}
      // Um contacto novo limpa os campos depois de guardado; um que se edita
      // fica como ficou.
      key={contacto ? contacto.id : estado.message}
      className="grid gap-3 sm:grid-cols-2"
      data-contacto={contacto?.id ?? 'novo'}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      {contacto ? <input type="hidden" name="contactoId" value={contacto.id} /> : null}

      <label className="text-sm font-medium text-ink-900" htmlFor={`${prefixo}-nome`}>
        Nome
        <input id={`${prefixo}-nome`} name="name" required maxLength={120} defaultValue={contacto?.name ?? ''} className={inputClass} />
      </label>
      <label className="text-sm font-medium text-ink-900" htmlFor={`${prefixo}-funcao`}>
        Função
        <input
          id={`${prefixo}-funcao`}
          name="jobTitle"
          maxLength={120}
          placeholder="Diretora de marketing"
          defaultValue={contacto?.jobTitle ?? ''}
          className={inputClass}
        />
      </label>
      <label className="text-sm font-medium text-ink-900" htmlFor={`${prefixo}-telefone`}>
        Telefone
        <input
          id={`${prefixo}-telefone`}
          name="phone"
          type="tel"
          maxLength={40}
          placeholder="+351 912 345 678"
          defaultValue={contacto?.phone ?? ''}
          className={inputClass}
        />
      </label>
      <label className="text-sm font-medium text-ink-900" htmlFor={`${prefixo}-email`}>
        Email
        <input
          id={`${prefixo}-email`}
          name="email"
          type="email"
          defaultValue={contacto?.email ?? ''}
          className={inputClass}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-ink-900 sm:col-span-2">
        <input
          type="checkbox"
          name="receivesReports"
          defaultChecked={contacto?.receivesReports ?? false}
          className="h-4 w-4 rounded border-ink-200 accent-ink-900"
        />
        Recebe o relatório mensal de todos os sites desta organização
      </label>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={aEnviar} className={contacto ? botaoSecundario : botaoPrincipal}>
          {aEnviar ? 'A guardar…' : contacto ? 'Guardar alterações' : 'Acrescentar contacto'}
        </button>
        <Resposta estado={estado} />
      </div>
    </form>
  )
}

export function AcrescentarEquipa() {
  const [estado, acao, aEnviar] = useActionState<EstadoDoFormulario, FormData>(acrescentarEquipaAction, {})
  return (
    <form action={acao} className="flex flex-wrap items-end gap-3 px-5 py-4">
      <label className="min-w-0 flex-1 text-sm font-medium text-ink-900">
        Email
        <input
          key={estado.message}
          name="email"
          type="email"
          required
          placeholder="nome@jelly.pt"
          className={inputClass}
        />
      </label>
      <button type="submit" disabled={aEnviar} className={botaoPrincipal}>
        {aEnviar ? 'A acrescentar…' : 'Acrescentar à equipa'}
      </button>
      <div className="w-full">
        <Resposta estado={estado} />
      </div>
    </form>
  )
}

export function RetirarDaEquipa({ userId, email }: { userId: string; email: string }) {
  const [estado, acao, aEnviar] = useActionState<EstadoDoFormulario, FormData>(retirarEquipaAction, {})
  return (
    <form
      action={acao}
      onSubmit={(evento) => {
        if (!window.confirm(`Retirar ${email} da Equipa Jelly? Deixa de ver os sites dos clientes.`)) {
          evento.preventDefault()
        }
      }}
      className="flex items-center gap-3"
    >
      <input type="hidden" name="userId" value={userId} />
      {estado.error ? <span className="text-xs font-medium text-mau">{estado.error}</span> : null}
      <button type="submit" disabled={aEnviar} className="text-xs font-semibold text-mau hover:underline">
        {aEnviar ? 'A retirar…' : 'Retirar'}
      </button>
    </form>
  )
}

export function MoverSite({
  siteId,
  atual,
  organizacoes,
}: {
  siteId: string
  atual: string
  organizacoes: { id: string; name: string }[]
}) {
  const [estado, acao, aEnviar] = useActionState<EstadoDoFormulario, FormData>(moverSiteAction, {})
  return (
    <form action={acao} className="flex flex-wrap items-end gap-3 px-5 py-4">
      <input type="hidden" name="siteId" value={siteId} />
      <label className="min-w-0 flex-1 text-sm font-medium text-ink-900">
        Organização do cliente
        <select name="organizationId" defaultValue={atual} className={inputClass}>
          {organizacoes.map((organizacao) => (
            <option key={organizacao.id} value={organizacao.id}>
              {organizacao.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={aEnviar} className={botaoSecundario}>
        {aEnviar ? 'A mudar…' : 'Mudar de organização'}
      </button>
      <p className="w-full text-xs text-ink-400">
        Quem tem acesso de cliente à organização vê no portal todos os sites dela. Cada cliente deve ter a sua.
      </p>
      <div className="w-full">
        <Resposta estado={estado} />
      </div>
    </form>
  )
}
