'use client'

import type { VerificationChallenge } from '@jellycare/checks'
import { useActionState, useState } from 'react'
import { checkVerification, type ActionState } from '../../actions'

/**
 * Prova de propriedade do domínio.
 *
 * As duas vias estão sempre disponíveis, com o mesmo token: muda só onde ele
 * é publicado. Escolher o método na criação do site era uma decisão prematura
 * — quem não controla o DNS do cliente, ou tem o domínio numa zona gerida por
 * terceiros, só descobre que o TXT não é viável depois de tentar, e nessa
 * altura não deve ter de trocar de método em lado nenhum.
 *
 * O DNS aparece primeiro por ser o mais comum, e o ficheiro fica a um clique,
 * dobrado, para não encher o ecrã a quem não precisa dele.
 *
 * As instruções quebram a linha em vez de rolarem na horizontal: num telemóvel
 * o token ficava cortado a meio e só aparecia a quem descobrisse que aquela
 * caixa rolava. O que está aqui existe para ser copiado.
 */
export function VerificationPanel({
  siteId,
  challenge,
  alternative,
  canManage,
}: {
  siteId: string
  challenge: VerificationChallenge
  /** A outra via, com o mesmo token. */
  alternative: VerificationChallenge
  canManage: boolean
}) {
  const porFicheiro = alternative.method === 'http_file'
  const [state, action, pending] = useActionState<ActionState, FormData>(checkVerification, {})
  const [showAlternative, setShowAlternative] = useState(false)

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-sm font-semibold text-amber-900">
        Falta provar a propriedade do domínio
      </h2>
      <p className="mt-1.5 text-sm text-amber-900/80">
        Até estar verificado, este site só é monitorizado em disponibilidade. As verificações de
        segurança exigem autorização comprovada do proprietário.
      </p>

      <pre className="mt-4 whitespace-pre-wrap break-all rounded-lg border border-amber-200 bg-white px-4 py-3 text-xs leading-relaxed text-ink-900">
        {challenge.instructions}
      </pre>

      {showAlternative ? (
        <>
          <p className="mt-3 text-xs font-medium text-amber-900">
            Em alternativa, {porFicheiro ? 'pelo servidor' : 'por DNS'} — basta uma das duas:
          </p>
          <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-lg border border-amber-200 bg-white px-4 py-3 text-xs leading-relaxed text-ink-900">
            {alternative.instructions}
          </pre>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowAlternative(true)}
          className="mt-3 text-left text-xs font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
        >
          {porFicheiro
            ? 'Não consegue mexer no DNS? Provar por ficheiro no servidor'
            : 'Prefere o DNS? Provar por registo TXT'}
        </button>
      )}

      {canManage && (
        <form action={action} className="mt-4 flex flex-wrap items-center gap-3">
          <input type="hidden" name="siteId" value={siteId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {pending ? 'A verificar…' : 'Verificar agora'}
          </button>

          {state.error && <span className="text-sm text-amber-900">{state.error}</span>}
          {state.message && <span className="text-sm text-green-700">{state.message}</span>}
        </form>
      )}
    </div>
  )
}
