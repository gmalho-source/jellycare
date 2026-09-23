'use client'

import type { Severity } from '@jellycare/core'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { Brand } from './brand'
import { Icone } from './icons'
import { RailContagem, RailGrupo, RailLink, RailList } from './rail'
import type { ResumoVigia } from '@/lib/scheduler-health'
import { sectionHref } from '@/lib/site-nav'

export interface SiteNaBarra {
  id: string
  label: string
  severity: Severity | null
  /** Já filtradas para este site e para quem está a ver. */
  seccoes: { slug: string; label: string }[]
}

/**
 * A moldura da aplicação.
 *
 * Barra lateral escura à esquerda no ecrã largo; barra escura no topo com a
 * navegação a rolar por baixo, no telemóvel. O escuro não é gosto: separa a
 * moldura do conteúdo sem precisar de uma linha, e dá um sítio permanente ao
 * estado do vigia.
 *
 * O vigia está sempre à vista, em todas as páginas. A faixa de aviso só
 * aparece quando há avaria, e durante dezoito horas de paragem a única
 * leitura disponível foi «não vi nenhum aviso» — que não é a mesma coisa que
 * «vi que está a vigiar».
 *
 * A coluna muda com a rota: a lista dos sites na raiz, as secções do site
 * quando se está dentro de um. Quem decide é o caminho, lido aqui no cliente,
 * porque a moldura está acima do ramo do site na árvore e não recebe os seus
 * parâmetros. As secções vêm já calculadas do servidor — que tem ligação a
 * uma ferramenta de manutenção e quem pode gerir a organização não é matéria
 * para o browser decidir.
 */
export function Shell({
  email,
  vigia,
  sites,
  sair,
  children,
}: {
  email: string
  vigia: ResumoVigia
  sites: SiteNaBarra[]
  sair: () => Promise<void>
  children: ReactNode
}) {
  const pathname = usePathname()
  const emRota = /^\/sites\/([^/]+)/.exec(pathname)?.[1]
  const ativo = emRota === undefined ? undefined : sites.find((site) => site.id === emRota)

  return (
    <div className="min-h-screen lg:flex">
      {/* A coluna escura é a caixa de fora; a barra lá dentro é que é fixa.
          Sem isto, numa página mais alta do que o ecrã o escuro acabava a
          meio e o resto da coluna ficava com o papel do conteúdo. */}
      <div className="bg-shell lg:w-[16.5rem] lg:shrink-0">
      <aside className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex items-center gap-3 px-4 py-3.5 lg:px-5 lg:py-5">
          <Link href="/" className="flex min-w-0 items-center">
            <Brand />
          </Link>

          <span className="flex-1" />

          {/* No telemóvel o vigia cabe numa pastilha de duas palavras; a
              caixa inteira fica no fundo da coluna, no ecrã largo. */}
          <VigiaCompacto vigia={vigia} />

          <form action={sair} className="lg:hidden">
            <button
              type="submit"
              aria-label="Sair"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-shell-text hover:bg-shell-raised hover:text-white"
            >
              <Icone nome="saida" className="h-4 w-4" />
            </button>
          </form>
        </div>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {ativo ? <RailDoSite site={ativo} /> : <RailDosSites sites={sites} />}
        </div>

        <div className="hidden lg:block lg:px-3 lg:pb-4 lg:pt-3">
          <VigiaPastilha vigia={vigia} />

          <div className="mt-2 flex items-center gap-1 px-1">
            <span className="min-w-0 flex-1 truncate text-xs text-shell-muted" title={email}>
              {email}
            </span>
            <form action={sair}>
              <button
                type="submit"
                className="flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-shell-text hover:bg-shell-raised hover:text-white"
              >
                <Icone nome="saida" className="h-3.5 w-3.5" />
                Sair
              </button>
            </form>
          </div>
        </div>
      </aside>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {children}
      </main>
    </div>
  )
}

/**
 * Fora de um site, a navegação de topo desta aplicação é escolher um site.
 *
 * Não há aqui secções globais inventadas: só o que existe. O ponto de
 * gravidade à esquerda de cada nome diz qual é que arde sem ser preciso
 * abrir nenhum.
 */
function RailDosSites({ sites }: { sites: SiteNaBarra[] }) {
  const comProblemas = sites.filter((site) => site.severity !== null).length

  return (
    <RailList>
      <RailLink
        href="/"
        icone="sites"
        exato
        extra={comProblemas > 0 ? <RailContagem>{comProblemas}</RailContagem> : undefined}
      >
        Sites
      </RailLink>
      <RailLink href="/sites/new" icone="mais" exato>
        Adicionar site
      </RailLink>

      {sites.length > 0 && <RailGrupo>Os seus sites</RailGrupo>}

      {sites.map((site) => (
        <RailLink
          key={site.id}
          href={`/sites/${site.id}`}
          marca={
            <span
              aria-hidden
              className={`sev-${site.severity ?? 'ok'} sev-ponto h-2 w-2 shrink-0 rounded-full`}
            />
          }
        >
          {site.label}
        </RailLink>
      ))}
    </RailList>
  )
}

function RailDoSite({ site }: { site: SiteNaBarra }) {
  return (
    <>
      <div className="hidden lg:block lg:px-5 lg:pb-4">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs font-medium text-shell-muted hover:text-white"
        >
          <Icone nome="voltar" className="h-3.5 w-3.5" />
          Todos os sites
        </Link>
        <p className="mt-2 truncate text-sm font-semibold text-white">{site.label}</p>
      </div>

      <RailList>
        <li className="lg:hidden">
          <Link
            href="/"
            aria-label="Todos os sites"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-shell-text hover:bg-shell-raised hover:text-white"
          >
            <Icone nome="voltar" className="h-4 w-4" />
          </Link>
        </li>

        <RailGrupo>{site.label}</RailGrupo>

        {site.seccoes.map((seccao) => (
          <RailLink
            key={seccao.slug || 'geral'}
            href={sectionHref(site.id, seccao.slug)}
            icone={seccao.slug || 'geral'}
            exato={seccao.slug.length === 0}
          >
            {seccao.label}
          </RailLink>
        ))}
      </RailList>
    </>
  )
}

function Ponto({ vigia }: { vigia: ResumoVigia }) {
  return (
    <span
      aria-hidden
      className={`h-2 w-2 shrink-0 rounded-full ${
        vigia.estado === 'ok'
          ? 'bg-saudavel shadow-[0_0_0_4px_rgb(47_163_127_/_0.18)]'
          : 'bg-alarme shadow-[0_0_0_4px_rgb(192_36_58_/_0.2)]'
      }`}
    />
  )
}

function VigiaCompacto({ vigia }: { vigia: ResumoVigia }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-shell-line bg-shell-raised px-3 py-1.5 lg:hidden">
      <Ponto vigia={vigia} />
      <span className="text-xs font-semibold text-white">
        {vigia.estado === 'ok' ? 'A vigiar' : 'Ver aviso'}
      </span>
    </span>
  )
}

function VigiaPastilha({ vigia }: { vigia: ResumoVigia }) {
  const conteudo = (
    <>
      <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-shell-muted">
        Vigia
      </span>
      <span className="mt-2 flex items-center gap-2">
        <Ponto vigia={vigia} />
        <span className="text-[0.8125rem] font-semibold text-white">{vigia.titulo}</span>
      </span>
      <span className="mt-1 block text-xs text-shell-muted">{vigia.detalhe}</span>
    </>
  )

  // Em avaria a pastilha leva à lista, que é onde a faixa explica o quê e
  // desde quando. A verde não leva a lado nenhum: não há nada para ver.
  if (vigia.estado === 'ok') {
    return (
      <div className="rounded-xl border border-shell-line bg-shell-raised px-3.5 py-3">
        {conteudo}
      </div>
    )
  }

  return (
    <Link
      href="/"
      className="block rounded-xl border border-alarme/40 bg-alarme/10 px-3.5 py-3 hover:bg-alarme/15"
    >
      {conteudo}
    </Link>
  )
}
