import { redirect } from 'next/navigation'
import { Brand } from '@/components/brand'
import { getCurrentUser } from '@/lib/session'
import { LoginForm } from './form'

export const dynamic = 'force-dynamic'

/**
 * Entrada.
 *
 * Fundo escuro, como as barras de topo, e pela mesma razão: a marca é branca
 * e vermelha e não sobrevive a fundo claro. Aqui o motivo é também outro —
 * é o primeiro ecrã que um cliente vê do produto, e vale a pena que a marca
 * ocupe o lugar em vez de se encolher num canto.
 *
 * O cartão do formulário fica branco de propósito: é onde se escreve, e um
 * campo de texto sobre escuro obrigaria a rever contrastes por um ganho
 * estético duvidoso.
 */
export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/')

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Brand className="h-9" />
          <p className="mt-3.5 text-sm text-ink-400">
            Manutenção ativa e proativa de websites
          </p>
        </div>

        <LoginForm />

        <p className="mt-6 text-center text-xs text-ink-400">
          Um produto Jelly. O acesso é por convite.
        </p>
      </div>
    </div>
  )
}
