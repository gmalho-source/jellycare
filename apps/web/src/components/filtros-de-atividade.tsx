import { FAMILIAS_DE_ATIVIDADE, type FamiliaDeAtividade } from '@jellycare/core'
import { PERIODOS, hrefComFiltro, type FiltroDaVista } from '@/lib/atividade'

/**
 * Os filtros do registo, em ligações e não num formulário: cada combinação
 * tem o seu endereço, que se pode guardar ou mandar a um colega.
 */
function Opcao({ href, ativa, children }: { href: string; ativa: boolean; children: string }) {
  return (
    <a
      href={href}
      aria-current={ativa ? 'true' : undefined}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        ativa ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 shadow-card hover:text-ink-900'
      }`}
    >
      {children}
    </a>
  )
}

export function FiltrosDeAtividade({
  base,
  filtro,
  familias,
}: {
  base: string
  filtro: FiltroDaVista
  /** As famílias que esta vista oferece. O portal não tem «Ações da equipa». */
  familias: FamiliaDeAtividade[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3" data-filtros-de-atividade>
      <div className="flex flex-wrap gap-2">
        {PERIODOS.map((periodo) => (
          <Opcao
            key={periodo.valor}
            href={hrefComFiltro(base, filtro, { periodo: periodo.valor })}
            ativa={filtro.periodo === periodo.valor}
          >
            {periodo.rotulo}
          </Opcao>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Opcao href={hrefComFiltro(base, filtro, { familia: null })} ativa={filtro.familia === null}>
          Tudo
        </Opcao>
        {familias.map((familia) => (
          <Opcao
            key={familia}
            href={hrefComFiltro(base, filtro, { familia })}
            ativa={filtro.familia === familia}
          >
            {FAMILIAS_DE_ATIVIDADE[familia]}
          </Opcao>
        ))}
      </div>
    </div>
  )
}
