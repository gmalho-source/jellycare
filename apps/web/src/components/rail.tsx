'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { Icone } from './icons'

/**
 * A coluna de navegação, dentro da barra lateral escura.
 *
 * Uma coluna no ecrã largo, uma faixa que rola na horizontal no telemóvel. A
 * faixa rola dentro de si própria — a página não — porque nove secções não
 * cabem em 390px e empilhá-las empurrava o conteúdo para fora do primeiro
 * ecrã.
 *
 * O que está aqui dentro muda com a rota: a lista dos sites na raiz, as
 * secções do site quando se está dentro de um. Quem decide é a rota paralela
 * `@rail`, não este componente.
 */
export function RailList({ children }: { children: ReactNode }) {
  return (
    <nav>
      <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-2 lg:py-0">
        {children}
      </ul>
    </nav>
  )
}

/** O rótulo que separa dois grupos de ligações. Só no ecrã largo. */
export function RailGrupo({ children }: { children: ReactNode }) {
  return (
    <li className="hidden px-4 pb-1.5 pt-4 lg:block">
      <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-shell-muted">
        {children}
      </span>
    </li>
  )
}

export function RailLink({
  href,
  icone,
  exato = false,
  marca,
  extra,
  children,
}: {
  href: string
  icone?: string
  /** A visão geral é prefixo de todas as outras secções: só conta exata. */
  exato?: boolean
  /** Ponto de gravidade à esquerda do rótulo, para a lista de sites. */
  marca?: ReactNode
  /** Contagem ou valor à direita. */
  extra?: ReactNode
  children: ReactNode
}) {
  const pathname = usePathname()
  const ativo = exato ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <li>
      <Link
        href={href}
        aria-current={ativo ? 'page' : undefined}
        className={`relative flex min-h-11 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium ${
          ativo
            ? 'bg-shell-raised text-white'
            : 'text-shell-text hover:bg-shell-raised hover:text-white'
        }`}
      >
        {/* O marcador vermelho é o único vermelho da marca fora do wordmark.
            No telemóvel a faixa é horizontal e um traço à esquerda não se
            lê, por isso só aparece a partir de `lg`. */}
        {ativo && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 hidden h-5 w-[3px] -translate-y-1/2 rounded-r-sm bg-jelly-500 lg:block"
          />
        )}
        {marca}
        {icone !== undefined && <Icone nome={icone} className="h-4 w-4 shrink-0" />}
        <span className="truncate">{children}</span>
        {extra !== undefined && (
          <>
            <span className="flex-1" />
            {extra}
          </>
        )}
      </Link>
    </li>
  )
}

/** A contagem à direita de uma ligação da coluna. */
export function RailContagem({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-shell-line px-2 py-0.5 text-[0.6875rem] font-semibold text-white">
      {children}
    </span>
  )
}
