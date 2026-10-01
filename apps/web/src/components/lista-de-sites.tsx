'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SiteSummary } from '@/lib/queries'
import { COOKIE_VISTA_SITES, filtrarSites, type VistaSites } from '@/lib/pesquisa-sites'
import { Icone } from './icons'
import { HealthBadge, formatRelative, formatUptime } from './ui'

const STATE_LABEL: Record<string, string> = {
  onboarding: 'Por verificar',
  active: 'Ativo',
  paused: 'Em pausa',
  archived: 'Arquivado',
}

/**
 * Os sites, em lista ou em grelha, com pesquisa.
 *
 * A escolha da vista fica num cookie e não no endereço: é uma preferência de
 * quem usa o painel, não uma leitura que se envia a alguém. O servidor lê o
 * cookie, por isso a página já chega na vista certa, sem saltar de uma para a
 * outra depois de carregar.
 */
export function ListaDeSites({ sites, vistaInicial }: { sites: SiteSummary[]; vistaInicial: VistaSites }) {
  const [vista, setVista] = useState<VistaSites>(vistaInicial)
  const [termo, setTermo] = useState('')
  const campo = useRef<HTMLInputElement>(null)

  const visiveis = useMemo(() => filtrarSites(sites, termo), [sites, termo])

  // «/» leva à pesquisa, como na maior parte das ferramentas: com muitos sites
  // é o caminho mais curto até ao que se procura.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== '/' || evento.metaKey || evento.ctrlKey || evento.altKey) return
      const alvo = evento.target as HTMLElement | null
      if (alvo && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))) return
      evento.preventDefault()
      campo.current?.focus()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [])

  const escolher = (nova: VistaSites) => {
    setVista(nova)
    document.cookie = `${COOKIE_VISTA_SITES}=${nova}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-sm">
          <span className="sr-only">Pesquisar sites</span>
          <Icone
            nome="pesquisa"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
          />
          <input
            ref={campo}
            type="search"
            value={termo}
            onChange={(evento) => setTermo(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'Escape') setTermo('')
            }}
            placeholder="Pesquisar sites"
            title="Pesquisar por nome ou domínio"
            className="min-h-11 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-10 text-sm text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:outline-none"
          />
          {termo === '' && (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-ink-200 px-1.5 text-[11px] text-ink-400 sm:block">
              /
            </kbd>
          )}
        </label>

        {termo.trim() !== '' && (
          <span className="text-xs text-ink-400" aria-live="polite">
            {visiveis.length} de {sites.length}
          </span>
        )}

        <span className="ml-auto flex gap-1 rounded-xl bg-ink-100 p-1" role="group" aria-label="Vista">
          {(
            [
              ['lista', 'Lista'],
              ['grelha', 'Grelha'],
            ] as const
          ).map(([valor, nome]) => (
            <button
              key={valor}
              type="button"
              onClick={() => escolher(valor)}
              aria-pressed={vista === valor}
              className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
                vista === valor ? 'bg-white text-ink-900 shadow-card' : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <Icone nome={valor} className="h-3.5 w-3.5" />
              {nome}
            </button>
          ))}
        </span>
      </div>

      {visiveis.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-ink-600">Nenhum site corresponde a «{termo.trim()}».</p>
          <button
            type="button"
            onClick={() => setTermo('')}
            className="mt-2 text-sm font-semibold text-ink-900 underline underline-offset-2"
          >
            Limpar a pesquisa
          </button>
        </div>
      ) : vista === 'grelha' ? (
        <Grelha sites={visiveis} />
      ) : (
        <Lista sites={visiveis} />
      )}
    </div>
  )
}

function Lista({ sites }: { sites: SiteSummary[] }) {
  return (
    <ul className="overflow-hidden rounded-2xl bg-white shadow-card" data-vista="lista">
      {/* Uma lista e não uma tabela. Quatro colunas de largura fixa não
          cabem num telemóvel, e uma tabela que rola na horizontal esconde
          metade da informação a quem só tem o telemóvel à mão: aqui as
          medidas passam para baixo do nome e nada sai do ecrã.

          A linha inteira é ligação. Antes só o nome é que era, e tocar na
          disponibilidade não fazia nada — num ecrã táctil isso lê-se como
          avaria. */}
      {sites.map((site) => (
        <li key={site.id} className="border-b border-ink-100 last:border-0">
          <Link
            href={`/sites/${site.id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50 sm:gap-4 sm:px-5 sm:py-3.5"
          >
            <span
              aria-hidden
              className={`sev-${site.worstSeverity ?? 'ok'} sev-ponto h-9 w-1 shrink-0 rounded-full`}
            />

            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-sm font-semibold text-ink-600 sm:flex">
              {site.label.trim().charAt(0).toUpperCase() || '·'}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-semibold tracking-tight text-ink-900">
                {site.label}
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-400">{site.hostname}</span>

              {/* No telemóvel as medidas vivem debaixo do nome; a partir
                  de `sm` cada uma tem a sua coluna à direita. */}
              <span className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
                <HealthBadge severity={site.worstSeverity} openFindings={site.openFindings} />
                <span className="font-mono text-xs tabular-nums text-ink-600">{formatUptime(site.uptime24h)}</span>
                <span className="text-xs text-ink-400">{formatRelative(site.lastRunAt)}</span>
              </span>
            </span>

            <span className="hidden w-20 text-right font-mono text-sm tabular-nums text-ink-600 sm:block">
              {formatUptime(site.uptime24h)}
            </span>

            <span className="hidden w-40 justify-end gap-2 sm:flex">
              {!site.verified && <span className="self-center text-xs text-ink-400">{STATE_LABEL[site.state]}</span>}
              <HealthBadge severity={site.worstSeverity} openFindings={site.openFindings} />
            </span>

            <span className="hidden w-24 text-right text-xs text-ink-400 sm:block">
              {formatRelative(site.lastRunAt)}
            </span>

            <Icone nome="seta" className="hidden h-4 w-4 shrink-0 text-ink-200 sm:block" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * A grelha: cada site com a imagem da homepage.
 *
 * A imagem é a que a PageSpeed tira no fim da medição diária. Um site sem
 * nenhuma — por verificar, ou ainda sem a primeira medição — fica com a
 * inicial e uma frase a dizer porquê, e não com um espaço vazio que parece
 * uma imagem partida.
 */
function Grelha({ sites }: { sites: SiteSummary[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-vista="grelha">
      {sites.map((site) => (
        <li key={site.id}>
          <Link
            href={`/sites/${site.id}`}
            className="group flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-card transition-shadow hover:shadow-raised"
          >
            <span className="relative block aspect-[16/10] overflow-hidden border-b border-ink-100 bg-ink-50">
              {site.capturaEm ? (
                // Uma imagem servida pela nossa rota, com controlo de acesso:
                // o otimizador do Next pedia-a sem a sessão de quem está a ver.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/sites/${site.id}/captura?v=${new Date(site.capturaEm).getTime()}`}
                  alt={`Homepage de ${site.label}`}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
                  data-captura
                />
              ) : (
                <span className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-lg font-semibold text-ink-600">
                    {site.label.trim().charAt(0).toUpperCase() || '·'}
                  </span>
                  <span className="text-xs text-ink-400">
                    {site.verified
                      ? 'A imagem aparece depois da próxima medição de velocidade.'
                      : 'A imagem aparece depois de provada a propriedade do domínio.'}
                  </span>
                </span>
              )}
              <span
                aria-hidden
                className={`sev-${site.worstSeverity ?? 'ok'} sev-ponto absolute inset-x-0 top-0 h-1`}
              />
            </span>

            <span className="flex flex-1 flex-col gap-3 p-4">
              <span className="min-w-0">
                <span className="block truncate text-[0.9375rem] font-semibold tracking-tight text-ink-900">
                  {site.label}
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink-400">{site.hostname}</span>
              </span>

              <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
                <HealthBadge severity={site.worstSeverity} openFindings={site.openFindings} />
                {!site.verified && <span className="text-xs text-ink-400">{STATE_LABEL[site.state]}</span>}
                <span className="ml-auto flex items-center gap-3 text-xs text-ink-400">
                  <span className="font-mono tabular-nums text-ink-600" title="Disponibilidade nas últimas 24 horas">
                    {formatUptime(site.uptime24h)}
                  </span>
                  <span>{formatRelative(site.lastRunAt)}</span>
                </span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
