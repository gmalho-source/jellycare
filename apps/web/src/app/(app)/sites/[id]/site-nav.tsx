'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { sectionHref, type SiteSection } from '@/lib/site-nav'

/**
 * A navegação entre as secções de um site.
 *
 * Coluna à esquerda no ecrã largo, faixa que rola na horizontal no telemóvel.
 * A faixa rola dentro de si própria — a página não — porque nove separadores
 * não cabem em 390px e empilhá-los em nove linhas empurrava o conteúdo para
 * fora do primeiro ecrã.
 */
export function SiteNav({ siteId, sections }: { siteId: string; sections: SiteSection[] }) {
  const pathname = usePathname()

  const ativo = (slug: string) => {
    const href = sectionHref(siteId, slug)
    // A visão geral é o prefixo de todas as outras: só conta quando é exata.
    return slug.length === 0 ? pathname === href : pathname.startsWith(href)
  }

  return (
    <nav className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 lg:flex-col lg:gap-0.5">
        {sections.map((section) => (
          <li key={section.slug || 'geral'}>
            <Link
              href={sectionHref(siteId, section.slug)}
              aria-current={ativo(section.slug) ? 'page' : undefined}
              className={`block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                ativo(section.slug)
                  ? 'bg-ink-900 font-medium text-white lg:bg-ink-100 lg:text-ink-900'
                  : 'text-ink-600 hover:bg-ink-100'
              }`}
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
