import type { ReactNode } from 'react'
import Link from 'next/link'
import { Brand } from '@/components/brand'
import { FONTES_PORTAL, FontPreload } from '@/components/font-preload'
import '@/styles/fonts-portal.css'

/**
 * As páginas legais são públicas.
 *
 * Um cliente tem de as poder ler antes de ter conta, e o jurídico dele tem de
 * as poder ler sem ter conta nenhuma. Um contrato só visível depois de entrar
 * não se avalia antes de assinar.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  // O cliente lê e aceita aqui, por isso com a marca Jelly, como o portal.
  return (
    <>
      <FontPreload hrefs={FONTES_PORTAL} />
      <div className="tema-jelly min-h-screen bg-ink-50">
        <header className="bg-ink-900">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
            <Link href="/" className="flex min-w-0 items-center gap-2.5" prefetch={false}>
              <Brand />
            </Link>
            <nav className="flex items-center gap-4 text-xs text-shell-muted">
              <Link href="/legal/dpa" className="hover:text-white" prefetch={false}>
                Tratamento de dados
              </Link>
              <Link href="/legal/subcontratantes" className="hover:text-white" prefetch={false}>
                Subcontratantes
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">{children}</main>
      </div>
    </>
  )
}
