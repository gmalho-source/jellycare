import { createHash } from 'node:crypto'
import { deliveryFor, isMoreSevere, type Severity } from './severity.js'

/**
 * Estados de um finding.
 *
 * `pending` é interno: o finding foi observado mas ainda não atingiu o número
 * de observações exigido pelo check. Nunca notifica e nunca aparece ao cliente.
 * Existe para que uma falha de rede pontual ou um 429 de um link externo não
 * gerem um alerta.
 */
export const FINDING_STATES = [
  'pending',
  'open',
  'acknowledged',
  'resolved',
  'ignored',
] as const

export type FindingState = (typeof FINDING_STATES)[number]

/** O que um check devolve quando deteta um problema. */
export interface ObservedFinding {
  /** Código estável do problema, ex. `link_broken`, `cert_expiring`. */
  code: string
  /**
   * O que torna esta ocorrência única dentro do código — normalmente o URL
   * afetado. Dois links quebrados diferentes são dois findings; o mesmo link
   * quebrado em dez runs é um só.
   */
  discriminator?: string
  severity: Severity
  title: string
  detail?: string
  /** Contexto para a equipa poder corrigir sem investigar do zero. */
  evidence?: Record<string, unknown>
}

/** Finding tal como está persistido. */
export interface StoredFinding {
  id: string
  siteId: string
  checkType: string
  fingerprint: string
  code: string
  discriminator?: string
  severity: Severity
  state: FindingState
  title: string
  detail?: string
  evidence?: Record<string, unknown>
  firstSeenAt: Date
  lastSeenAt: Date
  resolvedAt?: Date
  /** Observações consecutivas desde que o finding apareceu ou reabriu. */
  occurrences: number
}

export type NewFinding = Omit<StoredFinding, 'id'>

export interface FindingUpdate {
  id: string
  fingerprint: string
  changes: Partial<
    Pick<
      StoredFinding,
      | 'severity'
      | 'state'
      | 'title'
      | 'detail'
      | 'evidence'
      | 'lastSeenAt'
      | 'resolvedAt'
      | 'occurrences'
    >
  >
}

export type NotificationKind = 'opened' | 'escalated' | 'reopened' | 'resolved'

export interface FindingNotification {
  kind: NotificationKind
  fingerprint: string
  siteId: string
  checkType: string
  code: string
  discriminator?: string
  severity: Severity
  title: string
  detail?: string
  /** Severidade anterior, presente apenas em `escalated`. */
  previousSeverity?: Severity
}

const FINGERPRINT_SEPARATOR = String.fromCharCode(0)

/**
 * Identidade estável de um finding. É o que permite dizer "isto é o mesmo
 * problema de ontem" em vez de criar uma entrada nova a cada run.
 */
export function fingerprintOf(
  siteId: string,
  checkType: string,
  code: string,
  discriminator?: string,
): string {
  return createHash('sha256')
    .update([siteId, checkType, code, discriminator ?? ''].join(FINGERPRINT_SEPARATOR))
    .digest('hex')
    .slice(0, 32)
}

export interface ReconcileInput {
  siteId: string
  checkType: string
  /** Findings observados neste run. */
  observed: readonly ObservedFinding[]
  /** Findings já persistidos para este site e este check type. */
  existing: readonly StoredFinding[]
  /**
   * Observações consecutivas necessárias antes de um finding passar a `open`
   * e poder notificar. 1 = notifica à primeira.
   */
  confirmationsRequired?: number
  /**
   * Um run que falhou não observou nada — não pode resolver findings. Sem isto,
   * um timeout de rede marcaria todos os problemas do site como resolvidos.
   */
  runSucceeded?: boolean
  now?: Date
}

export interface ReconcileResult {
  creates: NewFinding[]
  updates: FindingUpdate[]
  notifications: FindingNotification[]
}

function notificationFrom(
  kind: NotificationKind,
  finding: Pick<
    StoredFinding,
    | 'siteId'
    | 'checkType'
    | 'fingerprint'
    | 'code'
    | 'discriminator'
    | 'severity'
    | 'title'
    | 'detail'
  >,
  previousSeverity?: Severity,
): FindingNotification {
  const notification: FindingNotification = {
    kind,
    fingerprint: finding.fingerprint,
    siteId: finding.siteId,
    checkType: finding.checkType,
    code: finding.code,
    severity: finding.severity,
    title: finding.title,
  }
  if (finding.discriminator !== undefined) notification.discriminator = finding.discriminator
  if (finding.detail !== undefined) notification.detail = finding.detail
  if (previousSeverity !== undefined) notification.previousSeverity = previousSeverity
  return notification
}

/**
 * Compara o que o run observou com o que já estava persistido e devolve as
 * mutações a aplicar mais as notificações a disparar.
 *
 * Regras:
 * - um problema novo só notifica depois de confirmado;
 * - um problema que persiste com a mesma severidade não volta a notificar;
 * - um agravamento de severidade notifica sempre;
 * - um problema silenciado (`ignored`) nunca notifica;
 * - um problema que desaparece é resolvido, e só avisa se era grave;
 * - um run falhado não resolve nada.
 */
export function reconcileFindings(input: ReconcileInput): ReconcileResult {
  const {
    siteId,
    checkType,
    observed,
    existing,
    confirmationsRequired = 1,
    runSucceeded = true,
    now = new Date(),
  } = input

  const creates: NewFinding[] = []
  const updates: FindingUpdate[] = []
  const notifications: FindingNotification[] = []

  const byFingerprint = new Map<string, StoredFinding>()
  for (const finding of existing) byFingerprint.set(finding.fingerprint, finding)

  const seen = new Set<string>()

  for (const obs of observed) {
    const fingerprint = fingerprintOf(siteId, checkType, obs.code, obs.discriminator)
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    const prior = byFingerprint.get(fingerprint)

    if (!prior) {
      const confirmed = confirmationsRequired <= 1
      const created: NewFinding = {
        siteId,
        checkType,
        fingerprint,
        code: obs.code,
        severity: obs.severity,
        state: confirmed ? 'open' : 'pending',
        title: obs.title,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrences: 1,
      }
      if (obs.discriminator !== undefined) created.discriminator = obs.discriminator
      if (obs.detail !== undefined) created.detail = obs.detail
      if (obs.evidence !== undefined) created.evidence = obs.evidence
      creates.push(created)
      if (confirmed) notifications.push(notificationFrom('opened', created))
      continue
    }

    // Silenciado pela equipa: regista que ainda lá está, mas não incomoda
    // ninguém — nem sequer se agravar.
    if (prior.state === 'ignored') {
      updates.push({
        id: prior.id,
        fingerprint,
        changes: { lastSeenAt: now, severity: obs.severity, occurrences: prior.occurrences + 1 },
      })
      continue
    }

    const reopening = prior.state === 'resolved'
    const occurrences = reopening ? 1 : prior.occurrences + 1
    const changes: FindingUpdate['changes'] = {
      lastSeenAt: now,
      occurrences,
      severity: obs.severity,
      title: obs.title,
    }
    if (obs.detail !== undefined) changes.detail = obs.detail
    if (obs.evidence !== undefined) changes.evidence = obs.evidence

    const confirmed = occurrences >= confirmationsRequired
    const next = { ...prior, ...changes, fingerprint }

    if (reopening) {
      // Um problema que volta é tratado como novo: tem de reconfirmar antes de
      // notificar, senão um site instável gera alertas em ciclo.
      changes.state = confirmed ? 'open' : 'pending'
      changes.resolvedAt = undefined
      if (confirmed) notifications.push(notificationFrom('reopened', next))
    } else if (prior.state === 'pending') {
      changes.state = confirmed ? 'open' : 'pending'
      if (confirmed) notifications.push(notificationFrom('opened', next))
    } else if (isMoreSevere(obs.severity, prior.severity)) {
      // Já estava aberto ou reconhecido e piorou — isto merece sempre aviso.
      changes.state = 'open'
      notifications.push(notificationFrom('escalated', next, prior.severity))
    }

    updates.push({ id: prior.id, fingerprint, changes })
  }

  if (!runSucceeded) return { creates, updates, notifications }

  for (const prior of existing) {
    if (seen.has(prior.fingerprint)) continue
    if (prior.state === 'resolved' || prior.state === 'ignored') continue

    updates.push({
      id: prior.id,
      fingerprint: prior.fingerprint,
      changes: { state: 'resolved', resolvedAt: now, occurrences: 0 },
    })

    // Só se avisa da recuperação daquilo que interrompeu alguém quando abriu.
    if (prior.state !== 'pending' && deliveryFor(prior.severity) === 'immediate') {
      notifications.push(notificationFrom('resolved', prior))
    }
  }

  return { creates, updates, notifications }
}
