import { cache } from 'react'
import {
  getCheckLiveness,
  getSchedulerHealth,
  resumirVigia,
  type CheckLiveness,
  type ResumoVigia,
  type SchedulerHealth,
} from './scheduler-health'

export interface EstadoVigia {
  health: SchedulerHealth
  checks: CheckLiveness[]
  resumo: ResumoVigia
  /** Verdadeiro só quando o agendador passa e nenhuma verificação está atrasada. */
  aVigiar: boolean
}

/**
 * O estado do vigia, uma vez por pedido.
 *
 * A barra lateral mostra-o em todas as páginas e a lista de sites mostra a
 * faixa de aviso com o mesmo dado. São ramos independentes da árvore, e sem
 * isto cada página corria as duas consultas duas vezes para chegar à mesma
 * resposta. A chave é a lista de organizações ordenada, porque `cache`
 * distingue argumentos por identidade e um array novo em cada chamada nunca
 * acertaria no que já foi lido.
 */
const ler = cache(async (chave: string): Promise<EstadoVigia> => {
  const organizacoes = chave.length === 0 ? [] : chave.split(',')

  const [health, checks] = await Promise.all([
    getSchedulerHealth(),
    getCheckLiveness(new Date(), organizacoes),
  ])

  return {
    health,
    checks,
    resumo: resumirVigia(health, checks),
    aVigiar: health.status === 'ok' && checks.every((check) => check.late === 0),
  }
})

export function lerVigia(organizationIds: readonly string[]): Promise<EstadoVigia> {
  return ler([...organizationIds].sort().join(','))
}
