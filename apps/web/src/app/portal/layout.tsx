import type { ReactNode } from 'react'
import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { signOut } from '../(app)/actions'

/**
 * Portal do cliente.
 *
 * Mora na mesma aplicação que o painel interno e partilha a autenticação, as
 * consultas e os componentes. O que muda é o que se mostra e como se diz: aqui
 * não há configuração, não há tokens de verificação, não há seletores CSS nem
 * nomes de checks. Um cliente quer saber se o site dele está bem, o que foi
 * encontrado, e ter os relatórios à mão.
 *
 * A equipa da Jelly também pode entrar, de propósito: ver o que o cliente vê
 * antes de uma reunião vale mais do que qualquer descrição.
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Link href="/portal" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-jelly-500">Jellycare</span>
            <span className="text-xs text-ink-400">manutenção e vigilância por Jelly</span>
          </Link>

          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-ink-600 sm:inline">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md px-2 py-1 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>

      <footer className="mx-auto max-w-5xl px-6 pb-10 text-xs text-ink-400">
        Alguma dúvida sobre o que está aqui? Fale connosco — estes números são o
        nosso trabalho e explicá-los faz parte dele.
      </footer>
    </div>
  )
}
