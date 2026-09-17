import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { LoginForm } from './form'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/')

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-jelly-500">Jellycare</h1>
          <p className="mt-1.5 text-sm text-ink-600">
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
