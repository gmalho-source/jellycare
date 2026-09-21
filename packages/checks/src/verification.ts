import { createHash, randomBytes } from 'node:crypto'
import { getDomain } from 'tldts'
import { request } from './http.js'

/**
 * Prova de propriedade do domínio.
 *
 * Nenhuma verificação de segurança corre contra um domínio cuja propriedade
 * não foi provada. Não é burocracia: em Portugal e na UE, examinar a
 * configuração de um site sem autorização do proprietário é, na melhor das
 * hipóteses, uma zona cinzenta legal. Ver docs/riscos.md.
 */

export type VerificationMethod = 'dns_txt' | 'http_file'

export interface VerificationChallenge {
  method: VerificationMethod
  /** Valor que o cliente tem de publicar. */
  token: string
  /** Onde publicar: nome do registo TXT ou caminho do ficheiro. */
  location: string
  /** Instruções prontas a mostrar no onboarding. */
  instructions: string
}

const TOKEN_PREFIX = 'jellycare-site-verification='

export function generateVerificationToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(16).toString('hex')}`
}

/** Caminho do ficheiro de verificação, derivado do token para não ser adivinhável. */
export function verificationFilePath(token: string): string {
  const digest = createHash('sha256').update(token).digest('hex').slice(0, 32)
  return `/.well-known/jellycare-${digest}.txt`
}

export function buildChallenge(
  method: VerificationMethod,
  hostname: string,
  token: string = generateVerificationToken(),
): VerificationChallenge {
  const domain = getDomain(hostname) ?? hostname

  if (method === 'dns_txt') {
    return {
      method,
      token,
      location: `_jellycare.${domain}`,
      instructions:
        `Crie um registo TXT em _jellycare.${domain} com o valor:\n\n${token}\n\n` +
        'A propagação de DNS pode demorar até algumas horas. Verificamos ' +
        'automaticamente de hora a hora.',
    }
  }

  const path = verificationFilePath(token)
  return {
    method,
    token,
    location: path,
    instructions:
      `Coloque um ficheiro de texto em https://${hostname}${path} com o seguinte conteúdo:\n\n` +
      `${token}\n\nO ficheiro pode ser removido assim que a verificação estiver concluída.`,
  }
}

export interface VerificationResult {
  verified: boolean
  method: VerificationMethod
  /** Explicação para mostrar ao cliente quando falha. */
  detail: string
  /** O que foi efetivamente encontrado, para diagnóstico. */
  observed?: string[]
}

export interface VerifyOptions {
  fetchImpl?: typeof globalThis.fetch
  resolveTxt?: (hostname: string) => Promise<string[][]>
  timeoutMs?: number
}

async function verifyDnsTxt(
  hostname: string,
  token: string,
  options: VerifyOptions,
): Promise<VerificationResult> {
  const domain = getDomain(hostname) ?? hostname
  const name = `_jellycare.${domain}`

  const resolver =
    options.resolveTxt ??
    (async (target: string) => {
      const { resolveTxt } = await import('node:dns/promises')
      return resolveTxt(target)
    })

  let records: string[][]
  try {
    records = await resolver(name)
  } catch {
    return {
      method: 'dns_txt',
      verified: false,
      detail: `Não foi encontrado nenhum registo TXT em ${name}. Se acabou de o criar, o DNS pode ainda não ter propagado.`,
    }
  }

  // O DNS parte strings longas em blocos de 255 caracteres; juntá-los é
  // obrigatório para encontrar o token inteiro.
  const values = records.map((chunks) => chunks.join('').trim())
  const verified = values.some((value) => value === token)

  return {
    method: 'dns_txt',
    verified,
    detail: verified
      ? `Registo TXT confirmado em ${name}.`
      : `Existe TXT em ${name}, mas nenhum corresponde ao token esperado.`,
    observed: values,
  }
}

async function verifyHttpFile(
  siteUrl: string,
  token: string,
  options: VerifyOptions,
): Promise<VerificationResult> {
  const path = verificationFilePath(token)
  const url = new URL(path, siteUrl).toString()

  try {
    const response = await request(url, {
      timeoutMs: options.timeoutMs ?? 10_000,
      maxBodyBytes: 4096,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    })

    if (response.status < 200 || response.status >= 300) {
      return {
        method: 'http_file',
        verified: false,
        detail: `${url} respondeu ${response.status}. Confirme que o ficheiro está publicado e acessível.`,
      }
    }

    const body = response.body.trim()
    const verified = body === token

    return {
      method: 'http_file',
      verified,
      detail: verified
        ? 'Ficheiro de verificação confirmado.'
        : 'O ficheiro existe mas o conteúdo não corresponde ao token. Confirme que não há espaços ou HTML à volta do valor.',
      observed: [body.slice(0, 200)],
    }
  } catch (error) {
    return {
      method: 'http_file',
      verified: false,
      detail: `Não foi possível obter ${url}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function verifyOwnership(
  input: { method: VerificationMethod; hostname: string; siteUrl: string; token: string },
  options: VerifyOptions = {},
): Promise<VerificationResult> {
  return input.method === 'dns_txt'
    ? verifyDnsTxt(input.hostname, input.token, options)
    : verifyHttpFile(input.siteUrl, input.token, options)
}
