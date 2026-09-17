/**
 * Severidade de um finding. A ordem importa: é usada para comparar
 * agravamentos e para decidir a política de notificação.
 */
export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const

export type Severity = (typeof SEVERITIES)[number]

const RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export function severityRank(severity: Severity): number {
  return RANK[severity]
}

/** Devolve a severidade mais alta de uma lista. `info` se a lista for vazia. */
export function maxSeverity(severities: readonly Severity[]): Severity {
  return severities.reduce<Severity>(
    (worst, s) => (severityRank(s) > severityRank(worst) ? s : worst),
    'info',
  )
}

export function isMoreSevere(a: Severity, b: Severity): boolean {
  return severityRank(a) > severityRank(b)
}

/**
 * Como é que um finding desta severidade chega ao cliente.
 *
 * O objetivo é não treinar ninguém a ignorar alertas: só o que exige ação
 * imediata é que interrompe alguém. O resto agrega.
 */
export type DeliveryChannel = 'immediate' | 'daily_digest' | 'monthly_report'

const DELIVERY: Record<Severity, DeliveryChannel> = {
  critical: 'immediate',
  high: 'immediate',
  medium: 'daily_digest',
  low: 'monthly_report',
  info: 'monthly_report',
}

export function deliveryFor(severity: Severity): DeliveryChannel {
  return DELIVERY[severity]
}
