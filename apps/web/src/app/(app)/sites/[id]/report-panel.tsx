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
  mesAnterior,
  mesEmCurso,
  mesAnteriorSemDados,
}: {
  siteId: string
  configuredRecipients: string[]
  lastRequest: ReportRequest | null
  /** Rótulo do último mês completo, ex. «agosto de 2026». */
  mesAnterior: string
  /** Rótulo do mês em curso, ex. «setembro de 2026 (até 30/09)». */
  mesEmCurso: string
  /** O site só entrou depois de o último mês acabar: esse mês não tem dados. */
  mesAnteriorSemDados: boolean
}) {
  const [state, action, pending] = useActionState<ReportRequestState, FormData>(
    requestReportAction,
    {},
  )

  const emCurso = lastRequest !== null && lastRequest.completedAt === null

  return (
    <form action={action} className="border-t border-ink-100 px-5 py-4">
      <input type="hidden" name="siteId" value={siteId} />

      {/* Um cliente novo não tem mês anterior: o único período com dados é o
          que está a decorrer. Por isso a escolha, e por isso o primeiro fica
          desligado quando não teria nada — antes, gerava um PDF vazio. */}
      <fieldset className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
        <legend className="sr-only">Período</legend>
        <label
          className={`flex items-center gap-2 text-sm ${mesAnteriorSemDados ? 'text-ink-400' : 'text-ink-900'}`}
        >
          <input
            type="radio"
            name="scope"
            value="last_month"
            defaultChecked={!mesAnteriorSemDados}
            disabled={mesAnteriorSemDados}
          />
          Último mês completo ({mesAnterior})
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-900">
          <input
            type="radio"
            name="scope"
            value="month_to_date"
            defaultChecked={mesAnteriorSemDados}
          />
          Mês em curso ({mesEmCurso})
        </label>
      </fieldset>
      {mesAnteriorSemDados ? (
        <p className="-mt-1 mb-3 text-xs text-ink-400">
          O site entrou depois do fim de {mesAnterior}: esse mês não tem dados para relatar.
        </p>
      ) : null}

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
        Gera o relatório do período escolhido com os dados de agora e envia-o. O do mês em
        curso é provisório: o do mês completo substitui-o quando sair. Deixando o campo vazio,
        vai para os destinatários configurados no site.
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
      ? `${MONTHS[request.periodMonth - 1]} de ${request.periodYear}${
          request.scope === 'month_to_date' ? ' (provisório)' : ''
        }`
      : request.scope === 'month_to_date'
        ? 'o mês em curso'
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
