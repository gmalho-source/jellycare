import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import { USER_AGENT } from '@jellycare/core'

export interface ReputationConfig {
  /** Chave da abuse.ch. Sem ela o URLhaus responde 401 e é saltado. */
  urlhausAuthKey?: string
  timeoutMs?: number
  /** Páginas adicionais a submeter, além da homepage. */
  additionalUrls?: string[]
}

export interface ProviderResult {
  provider: string
  findings: ObservedFinding[]
}

const URLHAUS_ENDPOINT = 'https://urlhaus-api.abuse.ch/v1/host/'

/*
 * Porque é que a Google Safe Browsing não está aqui.
 *
 * Foi implementada e retirada. Os termos da API v4 dizem "for non-commercial
 * use only", e o Jellycare é vendido — usá-la era violar a licença de um
 * fornecedor para vender um serviço de segurança, o que não se faz nem se
 * explica a um cliente. A alternativa com licença comercial é a Web Risk, que
 * é paga por consulta e não se justifica enquanto o URLhaus cobrir a parte do
 * malware.
 *
 * Fica escrito para ninguém a voltar a adicionar por parecer óbvia. Ver
 * docs/checks.md.
 */

interface UrlhausResponse {
  query_status?: string
  urls?: { url?: string; threat?: string; url_status?: string; date_added?: string }[]
}

/** URLhaus (abuse.ch): URLs do domínio conhecidos por distribuir malware. */
export async function queryUrlhaus(
  hostname: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
  authKey?: string,
): Promise<ObservedFinding[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(URLHAUS_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
        // A abuse.ch tornou a autenticação obrigatória; sem este header a
        // resposta é 401 e a fonte deixou simplesmente de funcionar.
        ...(authKey ? { 'Auth-Key': authKey } : {}),
      },
      body: new URLSearchParams({ host: hostname }).toString(),
    })

    if (!response.ok) throw new Error(`URLhaus respondeu ${response.status}`)

    const body = (await response.json()) as UrlhausResponse
    if (body.query_status !== 'ok') return []

    // Entradas já marcadas como offline são histórico: registam que o domínio
    // esteve comprometido, mas alertar sobre elas todos os dias é ruído.
    const active = (body.urls ?? []).filter((entry) => entry.url_status !== 'offline')

    return active.map((entry) => ({
      code: 'blacklisted_urlhaus',
      discriminator: entry.url ?? hostname,
      severity: 'critical',
      title: 'URL do domínio listado no URLhaus a distribuir malware',
      detail: `Ameaça reportada: ${entry.threat ?? 'desconhecida'}. Adicionado em ${entry.date_added ?? 'data desconhecida'}.`,
      evidence: { url: entry.url, threat: entry.threat, status: entry.url_status },
    }))
  } finally {
    clearTimeout(timer)
  }
}

export class NoReputationDataError extends Error {
  constructor(readonly failures: string[]) {
    super(`Nenhuma fonte de reputação respondeu: ${failures.join('; ')}`)
    this.name = 'NoReputationDataError'
  }
}

/** Uma fonte de reputação, com o nome que aparece nos avisos. */
export interface ReputationProvider {
  name: string
  query: () => Promise<ObservedFinding[]>
}

/**
 * Junta o que as fontes disseram.
 *
 * Está à parte do check, e exportado, porque é aqui que vive a regra que
 * importa e que hoje tem uma fonte só para a exercitar: uma fonte que falha
 * enquanto outra responde não pode deitar fora o que a outra encontrou. A
 * regra tem de estar escrita e testada antes de a segunda fonte chegar — foi
 * a ausência dela que deixou passar, em silêncio, meia cobertura perdida.
 */
export async function aggregateProviders(
  providers: readonly ReputationProvider[],
): Promise<CheckResult> {
  const results = await Promise.allSettled(providers.map((provider) => provider.query()))

  const findings: ObservedFinding[] = []
  const failures: string[] = []
  let succeeded = 0

  results.forEach((result, index) => {
    const name = providers[index]?.name ?? 'desconhecido'
    if (result.status === 'fulfilled') {
      succeeded++
      findings.push(...result.value)
    } else {
      const reason = result.reason
      failures.push(`${name}: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  })

  // Se nenhuma fonte respondeu, não observámos nada. Devolver "sem problemas"
  // faria a reconciliação marcar uma blacklistagem real como resolvida só
  // porque a API esteve em baixo.
  if (succeeded === 0) throw new NoReputationDataError(failures)

  // Uma fonte que falha enquanto outra responde não pode desaparecer. O
  // check tem sucesso — e tem de ter, senão uma chave mal configurada
  // deitava fora uma blacklistagem verdadeira que a outra fonte encontrou —
  // mas parte da cobertura foi-se, e isso é um defeito da plataforma que
  // alguém tem de corrigir. Não é um problema do site do cliente, por isso
  // não vira finding: fica no aviso da execução.
  return {
    findings,
    metrics: {
      providersQueried: providers.length,
      providersSucceeded: succeeded,
      providersFailed: failures.length,
      listings: findings.length,
    },
    ...(failures.length > 0
      ? {
          warnings: failures.map((failure) => `Fonte de reputação indisponível — ${failure}`),
        }
      : {}),
  }
}

export const reputationCheck: CheckDefinition<ReputationConfig> = {
  type: 'reputation',
  defaultIntervalMinutes: 60 * 24,
  confirmationsRequired: 1,

  async run(context: CheckContext, config: ReputationConfig): Promise<CheckResult> {
    const timeoutMs = config.timeoutMs ?? 15_000

    // Uma fonte sem credenciais é saltada, não tentada: chamá-la só para
    // receber 401 transformava "não configurada" em "falhada" e arrastava o
    // check inteiro com ela.
    const providers: ReputationProvider[] = []

    if (config.urlhausAuthKey) {
      providers.push({
        name: 'urlhaus',
        query: () =>
          queryUrlhaus(context.site.hostname, context.fetch, timeoutMs, config.urlhausAuthKey),
      })
    }

    if (providers.length === 0) {
      throw new NoReputationDataError([
        'nenhuma fonte configurada: defina URLHAUS_AUTH_KEY',
      ])
    }

    return aggregateProviders(providers)
  },
}
