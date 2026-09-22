import type { FindingNotification, Severity } from '@jellycare/core'
import { deliveryFor, severityRank } from '@jellycare/core'
import { type MaintenanceWindow } from './schedule.js'
import { isInAnyMaintenanceWindow, type MaintenanceSchedule } from '@jellycare/db'

export type NotificationChannel = 'email' | 'slack' | 'webhook'

export interface NotificationTarget {
  id: string
  organizationId: string
  /** Nulo aplica-se a todos os sites da organização. */
  siteId: string | null
  channel: NotificationChannel
  destination: string
  minSeverity: Severity
  enabled: boolean
}

export interface RoutingContext {
  organizationId: string
  siteId: string
  siteLabel: string
  maintenanceWindows: readonly MaintenanceWindow[]
  /** O horário que se repete, quando o site tem um. */
  maintenanceSchedule?: MaintenanceSchedule | null
  now: Date
}

export type RoutingDecision =
  | { deliver: true; target: NotificationTarget }
  | { deliver: false; target: NotificationTarget; reason: string }

/**
 * Decide para onde vai cada notificação.
 *
 * As regras existem todas para o mesmo fim: quem recebe um alerta da Jellycare
 * tem de poder assumir que vale a pena olhar. Um canal que dispara por tudo é
 * silenciado pelo destinatário em duas semanas e deixa de servir para nada.
 */
export function routeNotification(
  notification: FindingNotification,
  targets: readonly NotificationTarget[],
  context: RoutingContext,
): RoutingDecision[] {
  // As duas vias valem: a janela avulsa do trabalho planeado e o horário
  // recorrente. Um alerta de madrugada durante a manutenção semanal é tão
  // inútil como durante a avulsa.
  const inMaintenance = isInAnyMaintenanceWindow(
    context.maintenanceWindows,
    context.maintenanceSchedule ?? null,
    context.now,
  )

  return targets.map((target): RoutingDecision => {
    if (!target.enabled) return { deliver: false, target, reason: 'canal desativado' }

    if (target.organizationId !== context.organizationId) {
      return { deliver: false, target, reason: 'outra organização' }
    }

    if (target.siteId !== null && target.siteId !== notification.siteId) {
      return { deliver: false, target, reason: 'canal dedicado a outro site' }
    }

    if (severityRank(notification.severity) < severityRank(target.minSeverity)) {
      return { deliver: false, target, reason: `abaixo do mínimo (${target.minSeverity})` }
    }

    if (deliveryFor(notification.severity) !== 'immediate') {
      return {
        deliver: false,
        target,
        reason: `severidade ${notification.severity} entra no resumo, não em alerta imediato`,
      }
    }

    // Durante uma manutenção declarada o finding é registado na mesma; o que
    // não acontece é acordar alguém por causa de um deploy planeado.
    if (inMaintenance && notification.kind !== 'resolved') {
      return { deliver: false, target, reason: 'janela de manutenção' }
    }

    return { deliver: true, target }
  })
}

export function deliverableTargets(
  notification: FindingNotification,
  targets: readonly NotificationTarget[],
  context: RoutingContext,
): NotificationTarget[] {
  return routeNotification(notification, targets, context)
    .filter((decision): decision is { deliver: true; target: NotificationTarget } => decision.deliver)
    .map((decision) => decision.target)
}

const KIND_LABEL: Record<FindingNotification['kind'], string> = {
  opened: 'Novo problema',
  escalated: 'Problema agravado',
  reopened: 'Problema reincidente',
  resolved: 'Problema resolvido',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Crítico',
  high: 'Elevado',
  medium: 'Médio',
  low: 'Baixo',
  info: 'Informativo',
}

export interface RenderedNotification {
  subject: string
  /** Texto simples, usado no email e como fallback do Slack. */
  text: string
  /** Blocos do Slack, quando o canal é Slack. */
  slackBlocks: unknown[]
}

/**
 * Formata a notificação para o destinatário.
 *
 * Em linguagem de negócio, não de sysadmin: quem recebe isto pode ser o
 * marketing do cliente, não um programador.
 */
export function renderNotification(
  notification: FindingNotification,
  context: Pick<RoutingContext, 'siteLabel'>,
  siteUrl: string,
): RenderedNotification {
  const kind = KIND_LABEL[notification.kind]
  const severity = SEVERITY_LABEL[notification.severity]
  const subject = `[Jellycare] ${context.siteLabel}: ${notification.title}`

  const lines = [
    `${kind} — ${severity}`,
    '',
    `Site: ${context.siteLabel} (${siteUrl})`,
    `Problema: ${notification.title}`,
  ]

  if (notification.discriminator) lines.push(`Onde: ${notification.discriminator}`)
  if (notification.detail) lines.push('', notification.detail)
  if (notification.kind === 'escalated' && notification.previousSeverity) {
    lines.push('', `A severidade subiu de ${SEVERITY_LABEL[notification.previousSeverity]} para ${severity}.`)
  }
  if (notification.kind === 'resolved') {
    lines.push('', 'Nenhuma ação é necessária: a verificação seguinte confirmou que já está normalizado.')
  }

  return {
    subject,
    text: lines.join('\n'),
    slackBlocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${kind}: ${context.siteLabel}`, emoji: false },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${notification.title}*\n${notification.detail ?? ''}` },
        fields: [
          { type: 'mrkdwn', text: `*Severidade*\n${severity}` },
          { type: 'mrkdwn', text: `*Verificação*\n${notification.checkType}` },
        ],
      },
      ...(notification.discriminator
        ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: notification.discriminator }] }]
        : []),
    ],
  }
}

/**
 * Agrupa as notificações não imediatas para o resumo diário.
 *
 * Quinze links quebrados novos são uma entrada no resumo, não quinze emails.
 */
export function groupForDigest(
  notifications: readonly FindingNotification[],
): Map<string, FindingNotification[]> {
  const groups = new Map<string, FindingNotification[]>()

  for (const notification of notifications) {
    if (deliveryFor(notification.severity) !== 'daily_digest') continue
    const key = `${notification.siteId}:${notification.checkType}:${notification.code}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(notification)
    else groups.set(key, [notification])
  }

  return groups
}
