'use client'

import type { VerificationChallenge } from '@jellycare/checks'
import { useActionState } from 'react'
import { checkVerification, type ActionState } from '../../actions'

export function VerificationPanel({
  siteId,
  challenge,
  canManage,
}: {
  siteId: string
  challenge: VerificationChallenge
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(checkVerification, {})

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-sm font-semibold text-amber-900">
        Falta provar a propriedade do domínio
      </h2>
      <p className="mt-1.5 text-sm text-amber-900/80">
        Até estar verificado, este site só é monitorizado em disponibilidade. As verificações de
        segurança exigem autorização comprovada do proprietário.
      </p>

      <pre className="mt-4 overflow-x-auto rounded-lg border border-amber-200 bg-white px-4 py-3 text-xs leading-relaxed text-ink-900">
        {challenge.instructions}
      </pre>

      {canManage && (
        <form action={action} className="mt-4 flex items-center gap-3">
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
