/**
 * Contagens de disponibilidade por região, reduzidas a uma só.
 *
 * As percentagens rápidas do painel contam amostras em SQL. Com duas probes, a
 * contagem misturada fica a meio caminho: uma região barrada pela firewall do
 * servidor e outra que vê o site davam 50 % a um site que está de pé para toda
 * a gente. Conta-se por região e fica a melhor — a mesma regra do relatório,
 * onde o site está em cima se alguma região o vê em cima. É uma aproximação
 * (não cruza as regiões no tempo, como `mergeRegionSamples`), mas nunca acusa
 * o caminho de rede de uma probe como indisponibilidade do site.
 *
 * Com uma região só, devolve a contagem dessa região.
 */
export interface RegionCount {
  up: number
  total: number
}

export function bestRegionCount(rows: readonly RegionCount[]): RegionCount | null {
  let best: RegionCount | null = null
  for (const row of rows) {
    if (row.total <= 0) continue
    if (best === null) {
      best = row
      continue
    }
    const ratio = row.up / row.total
    const bestRatio = best.up / best.total
    if (ratio > bestRatio || (ratio === bestRatio && row.total > best.total)) best = row
  }
  return best
}
