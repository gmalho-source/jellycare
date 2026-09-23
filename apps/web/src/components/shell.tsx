'use client'

import type { Severity } from '@jellycare/core'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { Brand } from './brand'
import { Icone } from './icons'
import { RailContagem, RailGrupo, RailLink, RailList } from './rail'
import type { ResumoVigia } from '@/lib/scheduler-health'

export interface ItemRail {
  href: string
  label: string
  icone?: string
  /** A raiz é prefixo de tudo o que está por baixo: só conta exata. */
  exato?: boolean
  contagem?: number
}

export interface SiteNaBarra {
  href: string
  label: string
  severity: Severity | null
  /** Já filtradas para este site e para quem está a ver. */
  seccoes: ItemRail[]
}

/**
 * A moldura da aplicação.
 *
 * Serve os dois lados: o painel interno e o portal do cliente. As ligações
 * chegam prontas de quem a usa — os dois têm raízes diferentes (`/` e
 * `/portal`) e secções diferentes, e nada disso é matéria para o browser
 * decidir.
 *
 * Barra lateral escura à esquerda no ecrã largo. No telemóvel a navegação
 * fica **no fundo do ecrã**: um menu no topo obriga a mão a subir o
 * telemóvel inteiro a cada mudança de secção, e num painel que se consulta de
 * pé isso é a diferença entre olhar e não olhar.
 *
 * A pastilha do vigia é opcional de propósito. Um agendador parado é falha
 * nossa, não do site do cliente — é a mesma regra que já esconde a faixa de
 * aviso e a cobertura reduzida do portal.
 */
export function Shell({
  email,
  vigia,
  inicio,
  globais = [],
  grupo,
  sites,
  sair,
  children,
}: {
  email: string
  vigia?: ResumoVigia
  /** A raiz desta vista: «Sites» ou «Os meus sites». */
  inicio: ItemRail
  /** Ligações que existem fora de um site. */
  globais?: ItemRail[]
  /** O rótulo do grupo da lista de sites. */
  grupo: string
  sites: SiteNaBarra[]
  sair: () => Promise<void>
  children: ReactNode
}) {
  const pathname = usePathname()

  // O site ativo é aquele cujo endereço é prefixo do caminho atual. Compara-se
  // do mais longo para o mais curto para o caso de um endereço ser prefixo de
  // outro.
  const ativo = [...sites]
    .sort((a, b) => b.href.length - a.href.length)
    .find((site) => pathname === site.href || pathname.startsWith(`${site.href}/`))

  return (
    <div className="min-h-screen lg:flex">
      {/* A coluna escura é a caixa de fora; a barra lá dentro é que é fixa.
          Sem isto, numa página mais alta do que o ecrã o escuro acabava a
          meio e o resto da coluna ficava com o papel do conteúdo. */}
      <div className="bg-shell lg:w-[16.5rem] lg:shrink-0">
        <aside className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
          <div className="flex items-center gap-3 px-4 py-3.5 lg:px-5 lg:py-5">
            <Link href={inicio.href} className="flex min-w-0 items-center">
              <Brand />
            </Link>

            <span className="flex-1" />

            {/* No telemóvel o vigia cabe numa pastilha de duas palavras; a
                caixa inteira fica no fundo da coluna, no ecrã largo. */}
            {vigia && <VigiaCompacto vigia={vigia} />}

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

          {/* Coluna no ecrã largo, barra fixa no fundo no telemóvel. */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-shell-line bg-shell pb-[env(safe-area-inset-bottom)] lg:static lg:z-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:border-t-0 lg:pb-0">
            {ativo ? (
              <RailDoSite site={ativo} inicio={inicio} />
            ) : (
              <RailDosSites inicio={inicio} globais={globais} grupo={grupo} sites={sites} />
            )}
          </div>

          <div className="hidden lg:block lg:px-3 lg:pb-4 lg:pt-3">
            {vigia && <VigiaPastilha vigia={vigia} />}

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

      {/* O espaço em baixo é para a barra fixa: sem ele, o fim da página fica
          por trás do menu e ninguém chega ao último cartão. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-8">
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
function RailDosSites({
  inicio,
  globais,
  grupo,
  sites,
}: {
  inicio: ItemRail
  globais: ItemRail[]
  grupo: string
  sites: SiteNaBarra[]
}) {
  return (
    <RailList>
      {[inicio, ...globais].map((item) => (
        <RailLink
          key={item.href}
          href={item.href}
          icone={item.icone}
          exato={item.exato}
          extra={
            item.contagem !== undefined && item.contagem > 0 ? (
              <RailContagem>{item.contagem}</RailContagem>
            ) : undefined
          }
        >
          {item.label}
        </RailLink>
      ))}

      {sites.length > 0 && <RailGrupo>{grupo}</RailGrupo>}

      {sites.map((site) => (
        <RailLink
          key={site.href}
          href={site.href}
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

function RailDoSite({ site, inicio }: { site: SiteNaBarra; inicio: ItemRail }) {
  return (
    <>
      <div className="hidden lg:block lg:px-5 lg:pb-4">
        <Link
          href={inicio.href}
          className="flex items-center gap-1.5 text-xs font-medium text-shell-muted hover:text-white"
        >
          <Icone nome="voltar" className="h-3.5 w-3.5" />
          {inicio.label}
        </Link>
        <p className="mt-2 truncate text-sm font-semibold text-white">{site.label}</p>
      </div>

      <RailList>
        <li className="lg:hidden">
          <Link
            href={inicio.href}
            aria-label={inicio.label}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-shell-text hover:bg-shell-raised hover:text-white"
          >
            <Icone nome="voltar" className="h-4 w-4" />
          </Link>
        </li>

        <RailGrupo>{site.label}</RailGrupo>

        {site.seccoes.map((seccao) => (
          <RailLink key={seccao.href} href={seccao.href} icone={seccao.icone} exato={seccao.exato}>
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
