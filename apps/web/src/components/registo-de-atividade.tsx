import { descreverAtividade, type TipoDeAtividade } from '@jellycare/core'
import type { LinhaDeAtividade } from '@jellycare/db'
import { Card, EmptyState, Stat } from './ui'

/**
 * O registo de atividade, por dias, do mais recente para o mais antigo.
 *
 * O mesmo desenho serve o separador do site, a vista da equipa (com o nome do
 * site em cada linha) e o portal do cliente. O que muda é o que entra, e isso
 * decide-se na consulta, não aqui.
 */

const DIA = new Intl.DateTimeFormat('pt-PT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Lisbon',
})
const HORA = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' })
const CHAVE_DO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' })

/** O tom do ponto: verde para o que ficou feito, a gravidade para o que apareceu. */
function tom(linha: LinhaDeAtividade): string {
  const verdes: TipoDeAtividade[] = ['problema_resolvido', 'wp_atualizado']
  if (verdes.includes(linha.tipo)) return 'sev-ok'
  if (linha.tipo === 'wp_atualizacao_falhou') return 'sev-high'
  if (['problema_detetado', 'problema_agravou', 'problema_reapareceu'].includes(linha.tipo)) {
    return `sev-${linha.dados.severidade ?? 'low'}`
  }
  return 'sev-info'
}

function autor(linha: LinhaDeAtividade): string {
  if (!linha.autor) return 'Jellycare'
  return linha.autor.nome ?? linha.autor.email
}

export function RegistoDeAtividade({
  linhas,
  mostrarSite = false,
  hrefDoSite,
  vazio,
  limiteAtingido = false,
}: {
  linhas: LinhaDeAtividade[]
  mostrarSite?: boolean
  hrefDoSite?: (siteId: string) => string
  vazio: string
  limiteAtingido?: boolean
}) {
  if (linhas.length === 0) {
    return (
      <Card>
        <EmptyState>{vazio}</EmptyState>
      </Card>
    )
  }

  const dias: { chave: string; titulo: string; linhas: LinhaDeAtividade[] }[] = []
  for (const linha of linhas) {
    const chave = CHAVE_DO_DIA.format(linha.quando)
    let dia = dias[dias.length - 1]
    if (!dia || dia.chave !== chave) {
      dia = { chave, titulo: DIA.format(linha.quando), linhas: [] }
      dias.push(dia)
    }
    dia.linhas.push(linha)
  }

  return (
    <div className="space-y-4" data-registo-de-atividade>
      {dias.map((dia) => (
        <Card key={dia.chave}>
          <h2 className="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-ink-400 first-letter:uppercase">
            {dia.titulo}
          </h2>
          <ul className="divide-y divide-ink-100">
            {dia.linhas.map((linha) => (
              <li
                key={linha.id}
                data-atividade={linha.tipo}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-sm"
              >
                <span className="w-11 shrink-0 tabular-nums text-xs text-ink-400">{HORA.format(linha.quando)}</span>
                <span aria-hidden className={`${tom(linha)} sev-ponto h-2 w-2 shrink-0 self-center rounded-full`} />
                <span className="min-w-0 flex-1 text-ink-900">
                  {mostrarSite && (
                    <>
                      {hrefDoSite ? (
                        <a href={hrefDoSite(linha.siteId)} className="font-medium hover:underline">
                          {linha.siteLabel}
                        </a>
                      ) : (
                        <span className="font-medium">{linha.siteLabel}</span>
                      )}
                      <span className="text-ink-400"> · </span>
                    </>
                  )}
                  {descreverAtividade(linha.tipo, linha.dados)}
                  {linha.dados.issue?.url && (
                    <>
                      {' '}
                      <a
                        href={linha.dados.issue.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-ink-400 underline hover:text-ink-900"
                      >
                        ver issue
                      </a>
                    </>
                  )}
                </span>
                <span className="shrink-0 text-xs text-ink-400">{autor(linha)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {limiteAtingido && (
        <p className="text-center text-xs text-ink-400">
          A mostrar as entradas mais recentes. Escolha um período mais curto para ver o resto.
        </p>
      )}
    </div>
  )
}

/**
 * Os números do período, por cima da lista. É a resposta curta a «o que é que
 * se fez»; a lista é a longa.
 */
export function ResumoDeAtividade({
  contagem,
  interno,
}: {
  contagem: Partial<Record<TipoDeAtividade, number>>
  interno: boolean
}) {
  const n = (tipo: TipoDeAtividade) => contagem[tipo] ?? 0
  return (
    <div className={`grid grid-cols-2 gap-3 ${interno ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`} data-resumo-de-atividade>
      <Stat rotulo="Problemas resolvidos" valor={n('problema_resolvido')} />
      <Stat rotulo="Problemas detetados" valor={n('problema_detetado') + n('problema_reapareceu')} />
      <Stat rotulo="Atualizações aplicadas" valor={n('wp_atualizado')} />
      {interno && <Stat rotulo="Enviados ao Claude" valor={n('claude_resolve_pedido')} />}
    </div>
  )
}
