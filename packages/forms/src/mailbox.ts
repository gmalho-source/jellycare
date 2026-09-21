/**
 * Verificação de que a notificação do formulário chegou mesmo.
 *
 * Esta é a parte que nenhuma ferramenta do mercado faz bem. Confirmar que o
 * formulário aceitou a submissão não chega: o `wp_mail()` pode estar partido,
 * o SMTP pode ter expirado, e o email pode chegar ao spam. Nos três casos o
 * cliente perde leads durante meses sem dar por isso.
 */

export type AuthResult = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'policy' | 'permerror' | 'temperror'

export interface InboundEmail {
  /** Destinatário, incluindo o subendereçamento. */
  to: string
  from: string
  subject: string
  text?: string
  html?: string
  headers: Record<string, string | string[]>
  receivedAt: Date
  /** Veredito de spam do fornecedor de inbox, quando existe. */
  spamVerdict?: 'pass' | 'fail' | 'unknown'
  spamScore?: number
}

export interface CanaryReference {
  siteId: string
  token: string
}

/**
 * Extrai a referência do canário.
 *
 * O endereço é a fonte primária. O corpo é o plano B, para formulários que
 * enviam a notificação a partir de um endereço próprio e não preservam o
 * `reply-to` — mais comuns do que seria de esperar.
 */
export function extractCanaryReference(email: InboundEmail): CanaryReference | null {
  const fromAddress = /check\+([A-Za-z0-9-]+)-([a-f0-9]{8,})@/i.exec(email.to)
  if (fromAddress?.[1] && fromAddress[2]) {
    return { siteId: fromAddress[1], token: fromAddress[2] }
  }

  const haystack = `${email.subject}\n${email.text ?? ''}\n${email.html ?? ''}`
  const fromBody = /Referência do teste:\s*([a-f0-9]{8,})/i.exec(haystack)
  if (fromBody?.[1]) return { siteId: '', token: fromBody[1] }

  const embedded = /check\+([A-Za-z0-9-]+)-([a-f0-9]{8,})@/i.exec(haystack)
  if (embedded?.[1] && embedded[2]) return { siteId: embedded[1], token: embedded[2] }

  return null
}

export interface AuthenticationResults {
  spf: AuthResult | null
  dkim: AuthResult | null
  dmarc: AuthResult | null
}

const RESULT_VALUES = new Set<AuthResult>([
  'pass', 'fail', 'softfail', 'neutral', 'none', 'policy', 'permerror', 'temperror',
])

function readMethod(header: string, method: 'spf' | 'dkim' | 'dmarc'): AuthResult | null {
  // Os separadores são ";" mas os comentários entre parênteses podem conter
  // qualquer coisa, incluindo a palavra "fail" — por isso removem-se primeiro.
  const cleaned = header.replace(/\([^)]*\)/g, ' ')
  const pattern = new RegExp(`\\b${method}\\s*=\\s*([a-z]+)`, 'i')
  const match = pattern.exec(cleaned)
  const value = match?.[1]?.toLowerCase() as AuthResult | undefined
  return value && RESULT_VALUES.has(value) ? value : null
}

/**
 * Lê os cabeçalhos `Authentication-Results`.
 *
 * Podem existir vários, um por servidor que reencaminhou. O primeiro resultado
 * conclusivo de cada método é o que conta: é o do servidor mais próximo da
 * entrega.
 */
export function parseAuthenticationResults(
  headerValue: string | string[] | undefined,
): AuthenticationResults {
  const headers = headerValue === undefined ? [] : Array.isArray(headerValue) ? headerValue : [headerValue]
  const results: AuthenticationResults = { spf: null, dkim: null, dmarc: null }

  for (const header of headers) {
    for (const method of ['spf', 'dkim', 'dmarc'] as const) {
      if (results[method] !== null) continue
      results[method] = readMethod(header, method)
    }
  }

  return results
}

export interface DeliveryAssessment {
  received: true
  latencyMs: number
  auth: AuthenticationResults
  /**
   * `null` quando não é possível saber. Só se afirma que caiu no spam quando o
   * fornecedor de inbox o diz — inferir a partir da autenticação seria dizer
   * ao cliente algo que não observámos.
   */
  landedInSpam: boolean | null
  /** Problemas de autenticação que aumentam o risco de entrega no spam. */
  deliverabilityRisks: string[]
}

export interface MissingAssessment {
  received: false
  waitedMs: number
}

export type FormDeliveryAssessment = DeliveryAssessment | MissingAssessment

export function assessDelivery(
  email: InboundEmail,
  submittedAt: Date,
): DeliveryAssessment {
  const auth = parseAuthenticationResults(email.headers['authentication-results'])
  const risks: string[] = []

  if (auth.spf === 'fail' || auth.spf === 'softfail') {
    risks.push('O SPF do remetente falhou na verificação.')
  } else if (auth.spf === 'none' || auth.spf === null) {
    risks.push('A notificação chegou sem SPF verificável.')
  }

  if (auth.dkim === 'fail') risks.push('A assinatura DKIM falhou.')
  else if (auth.dkim === 'none' || auth.dkim === null) risks.push('A notificação chegou sem assinatura DKIM.')

  if (auth.dmarc === 'fail') risks.push('A verificação DMARC falhou.')

  const landedInSpam =
    email.spamVerdict === 'fail' ? true : email.spamVerdict === 'pass' ? false : null

  return {
    received: true,
    latencyMs: Math.max(0, email.receivedAt.getTime() - submittedAt.getTime()),
    auth,
    landedInSpam,
    deliverabilityRisks: risks,
  }
}
