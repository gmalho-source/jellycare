import type { ReactNode } from 'react'
import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { signOut } from './actions'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-jelly-500">Jellycare</span>
            <span className="text-xs text-ink-400">por Jelly</span>
          </Link>

          <div className="flex items-center gap-4 text-sm">
            <span className="text-ink-600">{user.email}</span>
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

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
