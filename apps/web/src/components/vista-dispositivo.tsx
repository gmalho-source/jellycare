import { pageSpeedCheck, pageSpeedDesktopCheck } from '@jellycare/checks'
import Link from 'next/link'
import { Icone } from './icons'

/**
 * Telemóvel ou computador.
 *
 * A Google indexa pelo telemóvel e é de lá que vem quem desiste antes de a
 * página abrir — por isso é o que aparece primeiro. Mas há sites em que o
 * tráfego que paga entra de um computador ao balcão de um escritório, e para
 * esses a medição de telemóvel sozinha descreve mal a realidade.
 *
 * A escolha vive no endereço e não no browser: assim uma leitura de
 * computador pode ser enviada a alguém tal como está.
 */
export type VistaDispositivo = 'telemovel' | 'computador'

export function vistaDe(valor: string | string[] | undefined): VistaDispositivo {
  return valor === 'computador' ? 'computador' : 'telemovel'
}

/** O tipo de verificação que alimenta cada vista. */
export function tipoDeVelocidade(vista: VistaDispositivo): string {
  return vista === 'computador' ? pageSpeedDesktopCheck.type : pageSpeedCheck.type
}

export function SeletorDispositivo({ base, vista }: { base: string; vista: VistaDispositivo }) {
  const opcoes: { valor: VistaDispositivo; label: string; icone: string; href: string }[] = [
    { valor: 'telemovel', label: 'Telemóvel', icone: 'telemovel', href: base },
    {
      valor: 'computador',
      label: 'Computador',
      icone: 'computador',
      href: `${base}?vista=computador`,
    },
  ]

  return (
    <span className="flex gap-1 rounded-xl bg-ink-100 p-1">
      {opcoes.map((opcao) => {
        const ativa = opcao.valor === vista
        return (
          <Link
            key={opcao.valor}
            href={opcao.href}
            aria-current={ativa ? 'page' : undefined}
            className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
              ativa ? 'bg-white text-ink-900 shadow-card' : 'text-ink-600 hover:text-ink-900'
            }`}
          >
            <Icone nome={opcao.icone} className="h-3.5 w-3.5" />
            {opcao.label}
          </Link>
        )
      })}
    </span>
  )
}
