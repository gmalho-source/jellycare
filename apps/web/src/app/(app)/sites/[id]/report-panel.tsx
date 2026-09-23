'use client'

import { useActionState } from 'react'
import type { ReportRequest } from '@jellycare/db'
import { formatRelative } from '@/components/ui'
import { requestReportAction, type ReportRequestState } from '../../actions'

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

/**
 * Envio imediato do relatório, a partir do painel.
 *
 * O dashboard não gera o PDF — não tem browser — por isso o botão deixa um
 * pedido e o worker executa-o em segundos. Daí a linguagem: "a preparar" e
 * não "enviado". Dizer que já foi enviado quando ainda não foi era prometer
 * a quem está a olhar para o ecrã uma coisa que pode ainda falhar.
 */
export function ReportPanel({
  siteId,
  configuredRecipients,
  lastRequest,
}: {
  siteId: string
  configuredRecipients: string[]
  lastRequest: ReportRequest | null
}) {
  const [state, action, pending] = useActionState<ReportRequestState, FormData>(
    requestReportAction,
    {},
  )

  const emCurso = lastRequest !== null && lastRequest.completedAt === null

  return (
    <form action={action} className="border-t border-ink-100 px-5 py-4">
      <input type="hidden" name="siteId" value={siteId} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="report-recipient" className="block text-xs text-ink-400">
            Enviar para
          </label>
          <input
            id="report-recipient"
            name="recipient"
            type="email"
            placeholder={
              configuredRecipients.length > 0
                ? configuredRecipients.join(', ')
                : 'ninguém configurado — indique um endereço'
            }
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={pending || emCurso}
          className="inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:opacity-60"
        >
          {pending ? 'A pedir…' : emCurso ? 'Em curso…' : 'Enviar agora'}
        </button>
      </div>

      <p className="mt-2 text-xs text-ink-400">
        Gera o relatório do último mês completo com os dados de agora e envia-o. Deixando o
        campo vazio, vai para os destinatários configurados no site.
      </p>

      {state.error ? <p className="mt-2 text-sm text-red-600">{state.error}</p> : null}
      {state.message ? <p className="mt-2 text-sm text-ink-600">{state.message}</p> : null}

      {lastRequest ? <LastRequest request={lastRequest} /> : null}
    </form>
  )
}

function LastRequest({ request }: { request: ReportRequest }) {
  const periodo =
    request.periodYear && request.periodMonth
      ? `${MONTHS[request.periodMonth - 1]} de ${request.periodYear}`
      : 'o último mês completo'

  if (!request.completedAt) {
    return (
      <p className="mt-3 text-xs text-ink-400">
        Pedido {formatRelative(request.requestedAt)}, ainda a ser executado.
      </p>
    )
  }

  if (request.error) {
    return (
      <p className="mt-3 text-xs text-red-600">
        O último pedido falhou {formatRelative(request.completedAt)}: {request.error}
      </p>
    )
  }

  return (
    <p className="mt-3 text-xs text-ink-400">
      {request.sentTo.length > 0
        ? `Relatório de ${periodo} enviado ${formatRelative(request.completedAt)} para ${request.sentTo.join(', ')}.`
        : `Relatório de ${periodo} gerado ${formatRelative(request.completedAt)}, mas não foi enviado: não há destinatários.`}
    </p>
  )
}
