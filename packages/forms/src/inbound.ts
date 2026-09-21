import { createHmac, timingSafeEqual } from 'node:crypto'
import type { InboundEmail } from './mailbox.js'

/**
 * Receção do email na caixa de verificação.
 *
 * O endpoint é público por natureza — tem de ser, para o fornecedor de inbox
 * lhe chegar — e escreve no histórico que sustenta o relatório do cliente. Sem
 * assinatura verificada, qualquer pessoa podia declarar que as notificações de
 * um site estão a funcionar quando não estão.
 */

export type SignatureScheme = 'jellycare' | 'mailgun'

export interface SignatureInput {
  scheme: SignatureScheme
  secret: string
  /** Corpo exatamente como chegou, antes de qualquer parsing. */
  rawBody: string
  signature: string
  /** Segundos desde a época, como o fornecedor os envia. */
  timestamp: string
  /** Token da mensagem; só o Mailgun o usa. */
  token?: string
  now?: Date
  /** Tolerância de relógio e de atraso na entrega. */
  toleranceMs?: number
}

export type SignatureVerdict =
  | { valid: true }
  | { valid: false; reason: 'missing' | 'stale' | 'mismatch' }

const DEFAULT_TOLERANCE_MS = 5 * 60_000

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * Valida a assinatura da entrega.
 *
 * O carimbo temporal entra no cálculo e é verificado contra o relógio: sem
 * isso, uma entrega legítima capturada uma vez podia ser reenviada
 * indefinidamente para falsificar entregas futuras.
 */
export function verifyInboundSignature(input: SignatureInput): SignatureVerdict {
  if (!input.signature || !input.timestamp) return { valid: false, reason: 'missing' }
  if (input.scheme === 'mailgun' && !input.token) return { valid: false, reason: 'missing' }

  const seconds = Number(input.timestamp)
  if (!Number.isFinite(seconds)) return { valid: false, reason: 'missing' }

  const now = input.now ?? new Date()
  const tolerance = input.toleranceMs ?? DEFAULT_TOLERANCE_MS
  if (Math.abs(now.getTime() - seconds * 1000) > tolerance) {
    return { valid: false, reason: 'stale' }
  }

  const payload =
    input.scheme === 'mailgun'
      ? `${input.timestamp}${input.token}`
      : `${input.timestamp}.${input.rawBody}`

  const expected = createHmac('sha256', input.secret).update(payload).digest('hex')
  const provided = input.signature.replace(/^sha256=/i, '').trim().toLowerCase()

  return constantTimeEquals(expected, provided)
    ? { valid: true }
    : { valid: false, reason: 'mismatch' }
}

type Payload = Record<string, unknown>

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function firstString(payload: Payload, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = asString(payload[key])
    if (value) return value
  }
  return undefined
}

/**
 * Normaliza os cabeçalhos, venham eles como objeto ou como lista de pares.
 *
 * Os fornecedores divergem aqui: o Mailgun manda uma lista de pares em JSON, o
 * Cloudflare e o Postmark mandam objetos. Os nomes vêm em maiúsculas e
 * minúsculas conforme o servidor de origem, por isso ficam todos em minúsculas.
 */
export function normaliseHeaders(raw: unknown): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}

  const add = (name: string, value: string) => {
    const key = name.toLowerCase()
    const existing = headers[key]
    if (existing === undefined) headers[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else headers[key] = [existing, value]
  }

  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return headers
    }
  }

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
        add(entry[0], entry[1])
      } else if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as Payload).name === 'string' &&
        typeof (entry as Payload).value === 'string'
      ) {
        add((entry as Payload).name as string, (entry as Payload).value as string)
      }
    }
    return headers
  }

  if (parsed && typeof parsed === 'object') {
    for (const [name, value] of Object.entries(parsed as Payload)) {
      if (typeof value === 'string') add(name, value)
      else if (Array.isArray(value)) {
        for (const item of value) if (typeof item === 'string') add(name, item)
      }
    }
  }

  return headers
}

function parseSpamVerdict(
  payload: Payload,
  headers: Record<string, string | string[]>,
): InboundEmail['spamVerdict'] {
  const explicit = firstString(payload, ['spam-verdict', 'spamVerdict', 'SpamVerdict'])
  if (explicit) {
    const value = explicit.toLowerCase()
    if (value.includes('fail') || value === 'spam' || value === 'true') return 'fail'
    if (value.includes('pass') || value === 'ham' || value === 'false') return 'pass'
  }

  const flag = headers['x-spam-flag']
  if (typeof flag === 'string') return /yes/i.test(flag) ? 'fail' : 'pass'

  return undefined
}

function parseSpamScore(payload: Payload, headers: Record<string, string | string[]>) {
  const fromPayload = payload['spam-score'] ?? payload['spamScore'] ?? payload['SpamScore']
  const candidate =
    typeof fromPayload === 'number'
      ? fromPayload
      : typeof fromPayload === 'string'
        ? Number(fromPayload)
        : typeof headers['x-spam-score'] === 'string'
          ? Number(headers['x-spam-score'])
          : Number.NaN

  return Number.isFinite(candidate) ? candidate : undefined
}

/**
 * Converte a entrega do fornecedor num email.
 *
 * Os nomes dos campos variam entre Mailgun, Cloudflare Email Workers e
 * Postmark; aceitam-se os três em vez de nos prendermos a um. Devolve `null`
 * quando não há sequer destinatário, que é o mínimo para o email servir de
 * alguma coisa.
 */
export function parseInboundPayload(payload: Payload, receivedAt = new Date()): InboundEmail | null {
  const to = firstString(payload, ['to', 'To', 'recipient', 'Recipient', 'recipients'])
  if (!to) return null

  const headers = normaliseHeaders(
    payload['message-headers'] ?? payload['headers'] ?? payload['Headers'] ?? {},
  )

  const timestampSeconds = Number(payload['timestamp'])
  const stamped =
    Number.isFinite(timestampSeconds) && timestampSeconds > 0
      ? new Date(timestampSeconds * 1000)
      : receivedAt

  const email: InboundEmail = {
    to,
    from: firstString(payload, ['from', 'From', 'sender', 'Sender']) ?? '',
    subject: firstString(payload, ['subject', 'Subject']) ?? '',
    headers,
    receivedAt: stamped,
  }

  const text = firstString(payload, ['text', 'body-plain', 'TextBody', 'stripped-text'])
  const html = firstString(payload, ['html', 'body-html', 'HtmlBody'])
  if (text) email.text = text
  if (html) email.html = html

  const spamVerdict = parseSpamVerdict(payload, headers)
  if (spamVerdict) email.spamVerdict = spamVerdict

  const spamScore = parseSpamScore(payload, headers)
  if (spamScore !== undefined) email.spamScore = spamScore

  return email
}
