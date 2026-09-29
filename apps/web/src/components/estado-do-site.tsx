import Link from 'next/link'
import { COR_ESTADO } from '@/lib/chart-colors'
import type { Leitura, Semaforo } from '@/lib/estado-do-site'
import { Icone } from './icons'

const COR: Record<Semaforo, string> = {
  verde: COR_ESTADO.bom,
  laranja: COR_ESTADO.medio,
  vermelho: COR_ESTADO.mau,
  cinzento: COR_ESTADO.sem,
}

/**
 * Um cartão de estado: ícone, nome, e o semáforo com a palavra ao lado.
 *
 * A cor tinge o ícone e o ponto, e nunca o texto: a palavra lê-se em tinta
 * normal, para quem não distingue o verde do laranja e para quem imprime a
 * página. O cartão inteiro leva ao detalhe.
 */
function Cartao({
  icone,
  titulo,
  leitura,
  href,
}: {
  icone: string
  titulo: string
  leitura: Leitura
  href: string
}) {
  const cor = COR[leitura.semaforo]

  return (
    <Link
      href={href}
      data-estado={titulo}
      data-semaforo={leitura.semaforo}
      className="group flex items-center gap-4 rounded-2xl bg-white px-5 py-4 shadow-card transition-shadow hover:shadow-raised"
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
        style={{ color: cor, backgroundColor: `${cor}14` }}
      >
        <Icone nome={icone} className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-900">{titulo}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-600">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
          {leitura.estado}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-400">{leitura.detalhe}</span>
      </span>
      <Icone
        nome="seta"
        className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  )
}

/**
 * Segurança e desempenho num relance, no topo da página do site.
 *
 * Responde à primeira pergunta de quem abre o portal — está tudo bem? — antes
 * de qualquer número. Os números estão logo abaixo, e cada cartão leva ao
 * detalhe de onde a cor vem.
 */
export function EstadoDoSite({
  seguranca,
  desempenho,
  hrefSeguranca,
  hrefDesempenho,
}: {
  seguranca: Leitura
  desempenho: Leitura
  hrefSeguranca: string
  hrefDesempenho: string
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Cartao icone="escudo" titulo="Segurança" leitura={seguranca} href={hrefSeguranca} />
      <Cartao icone="desempenho" titulo="Desempenho" leitura={desempenho} href={hrefDesempenho} />
    </div>
  )
}
