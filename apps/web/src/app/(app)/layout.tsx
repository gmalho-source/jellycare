import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Brand } from '@/components/brand'
import { isClientOnly, requireUser } from '@/lib/session'
import { signOut } from './actions'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()
  // O painel interno mostra configuração, tokens de verificação e o inventário
  // de todos os sites da organização. Um cliente não tem nada que fazer aqui.
  if (isClientOnly(user)) redirect('/portal')

  return (
    <div className="min-h-screen">
      <header className="bg-ink-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Brand />
            <span className="hidden text-xs text-ink-400 sm:inline">por Jelly</span>
          </Link>

          <div className="flex min-w-0 items-center gap-2 text-sm sm:gap-4">
            {/* Truncado e não escondido: saber com que conta se está dentro
                importa tanto no telemóvel como no computador. */}
            <span className="max-w-[9rem] truncate text-ink-400 sm:max-w-none">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md px-2 py-1 text-ink-400 hover:bg-white/10 hover:text-white"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  )
}
