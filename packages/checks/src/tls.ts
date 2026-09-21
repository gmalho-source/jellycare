import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import type { Severity } from '@jellycare/core'
import { connect, type PeerCertificate } from 'node:tls'

export interface CertificateInfo {
  subject: string
  issuer: string
  validFrom: Date
  validTo: Date
  subjectAltNames: string[]
  /** Tamanho da chave em bits, quando o runtime o expõe. */
  keyBits?: number
  /** A cadeia valida contra as CAs de confiança do sistema? */
  authorized: boolean
  authorizationError?: string
}

export type CertificateFetcher = (hostname: string, port: number) => Promise<CertificateInfo>

export interface TlsConfig {
  port?: number
  timeoutMs?: number
  /** Injetável para testes; em produção usa `fetchCertificate`. */
  fetcher?: CertificateFetcher
}

function parseAltNames(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.toLowerCase().startsWith('dns:'))
    .map((entry) => entry.slice(4).toLowerCase())
}

/**
 * Um nome do certificado cobre este hostname?
 *
 * Um wildcard cobre exatamente um nível: `*.cliente.pt` serve `www.cliente.pt`
 * mas não `cliente.pt` nem `a.b.cliente.pt`. Implementar isto com um
 * `endsWith` daria por válido um certificado que o browser rejeita.
 */
export function certificateNameMatches(pattern: string, hostname: string): boolean {
  const name = pattern.toLowerCase().trim()
  const host = hostname.toLowerCase().trim()
  if (name === host) return true
  if (!name.startsWith('*.')) return false

  const suffix = name.slice(2)
  if (!host.endsWith(`.${suffix}`)) return false

  const label = host.slice(0, host.length - suffix.length - 1)
  return label.length > 0 && !label.includes('.')
}

export function certificateCoversHostname(cert: CertificateInfo, hostname: string): boolean {
  const names = cert.subjectAltNames.length > 0 ? cert.subjectAltNames : [cert.subject]
  return names.some((name) => certificateNameMatches(name, hostname))
}

/**
 * Um certificado pode repetir um campo do Distinguished Name, e nesse caso o
 * Node devolve um array. Ficamos pelo primeiro valor.
 */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

/** Liga-se ao host e devolve o certificado apresentado, válido ou não. */
export function fetchCertificate(
  hostname: string,
  port: number,
  timeoutMs = 10_000,
): Promise<CertificateInfo> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: hostname,
      port,
      servername: hostname,
      // Um certificado inválido é precisamente o que queremos reportar, não um
      // motivo para desistir da ligação.
      rejectUnauthorized: false,
      timeout: timeoutMs,
    })

    const fail = (error: Error) => {
      socket.destroy()
      reject(error)
    }

    socket.once('secureConnect', () => {
      const peer = socket.getPeerCertificate(false) as PeerCertificate & {
        bits?: number
        subjectaltname?: string
      }

      if (!peer || Object.keys(peer).length === 0) {
        fail(new Error('O servidor não apresentou certificado'))
        return
      }

      const info: CertificateInfo = {
        subject: first(peer.subject?.CN).toLowerCase(),
        issuer: first(peer.issuer?.O) || first(peer.issuer?.CN) || 'desconhecido',
        validFrom: new Date(peer.valid_from),
        validTo: new Date(peer.valid_to),
        subjectAltNames: parseAltNames(peer.subjectaltname),
        authorized: socket.authorized,
      }
      if (typeof peer.bits === 'number') info.keyBits = peer.bits
      if (socket.authorizationError) info.authorizationError = String(socket.authorizationError)

      socket.end()
      resolve(info)
    })

    socket.once('timeout', () => fail(new Error('Tempo limite excedido na ligação TLS')))
    socket.once('error', fail)
  })
}

/** Quanto mais perto da expiração, mais alto o alerta. */
export function expirySeverity(daysRemaining: number): Severity | null {
  if (daysRemaining < 0) return 'critical'
  if (daysRemaining <= 7) return 'high'
  if (daysRemaining <= 14) return 'medium'
  if (daysRemaining <= 30) return 'low'
  return null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export const tlsCheck: CheckDefinition<TlsConfig> = {
  type: 'tls',
  defaultIntervalMinutes: 60 * 24,
  confirmationsRequired: 1,

  async run(context: CheckContext, config: TlsConfig): Promise<CheckResult> {
    const findings: ObservedFinding[] = []
    const port = config.port ?? 443
    const fetcher =
      config.fetcher ?? ((host, p) => fetchCertificate(host, p, config.timeoutMs ?? 10_000))

    const cert = await fetcher(context.site.hostname, port)
    const daysRemaining = Math.floor((cert.validTo.getTime() - context.now.getTime()) / MS_PER_DAY)

    const severity = expirySeverity(daysRemaining)
    if (severity === 'critical') {
      findings.push({
        code: 'cert_expired',
        severity,
        title: `O certificado expirou há ${Math.abs(daysRemaining)} dias`,
        detail: `Válido até ${cert.validTo.toISOString().slice(0, 10)}. O browser bloqueia o acesso ao site.`,
        evidence: { validTo: cert.validTo.toISOString(), issuer: cert.issuer },
      })
    } else if (severity) {
      findings.push({
        code: 'cert_expiring',
        severity,
        title: `O certificado expira em ${daysRemaining} dias`,
        detail: `Válido até ${cert.validTo.toISOString().slice(0, 10)}, emitido por ${cert.issuer}.`,
        evidence: { validTo: cert.validTo.toISOString(), daysRemaining, issuer: cert.issuer },
      })
    }

    if (!certificateCoversHostname(cert, context.site.hostname)) {
      findings.push({
        code: 'cert_hostname_mismatch',
        severity: 'critical',
        title: 'O certificado não cobre este domínio',
        detail:
          `O certificado é válido para ${cert.subjectAltNames.join(', ') || cert.subject}, ` +
          `mas o site responde em ${context.site.hostname}.`,
        evidence: { hostname: context.site.hostname, altNames: cert.subjectAltNames },
      })
    }

    // Só se reporta a cadeia quando a data está boa: um certificado expirado
    // também falha a validação, e dois alertas para a mesma causa é ruído.
    if (!cert.authorized && severity !== 'critical') {
      findings.push({
        code: 'cert_untrusted',
        severity: 'critical',
        title: 'O certificado não é válido para os browsers',
        detail:
          cert.authorizationError ??
          'A cadeia não valida contra as autoridades de certificação de confiança.',
        evidence: { issuer: cert.issuer, error: cert.authorizationError },
      })
    }

    if (cert.keyBits !== undefined && cert.keyBits < 2048) {
      findings.push({
        code: 'cert_weak_key',
        severity: 'medium',
        title: `Chave do certificado com apenas ${cert.keyBits} bits`,
        detail: 'Abaixo dos 2048 bits considerados o mínimo aceitável.',
        evidence: { keyBits: cert.keyBits },
      })
    }

    return { findings, metrics: { certDaysRemaining: daysRemaining } }
  },
}
