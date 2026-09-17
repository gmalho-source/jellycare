import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import { USER_AGENT } from '@jellycare/core'

export interface ReputationConfig {
  /** Sem chave, o Safe Browsing é saltado e a cobertura fica reduzida. */
  safeBrowsingApiKey?: string
  timeoutMs?: number
  /** Páginas adicionais a submeter, além da homepage. */
  additionalUrls?: string[]
}

export interface ProviderResult {
  provider: string
  findings: ObservedFinding[]
}

const SAFE_BROWSING_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find'
const URLHAUS_ENDPOINT = 'https://urlhaus-api.abuse.ch/v1/host/'

interface SafeBrowsingMatch {
  threatType?: string
  platformType?: string
  threat?: { url?: string }
}

const THREAT_LABELS: Record<string, string> = {
  MALWARE: 'malware',
  SOCIAL_ENGINEERING: 'phishing ou engenharia social',
  UNWANTED_SOFTWARE: 'software indesejado',
  POTENTIALLY_HARMFUL_APPLICATION: 'aplicação potencialmente prejudicial',
}

/**
 * Google Safe Browsing.
 *
 * É o que determina se o Chrome mostra o ecrã vermelho de aviso aos
 * visitantes. Para o cliente, aparecer aqui custa mais do que o próprio
 * malware: o tráfego orgânico desaparece no dia seguinte.
 */
export async function querySafeBrowsing(
  urls: string[],
  apiKey: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<ObservedFinding[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(`${SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify({
        client: { clientId: 'jellycare', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: Object.keys(THREAT_LABELS),
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map((url) => ({ url })),
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Safe Browsing respondeu ${response.status}`)
    }

    const body = (await response.json()) as { matches?: SafeBrowsingMatch[] }
    const matches = body.matches ?? []

    return matches.map((match) => {
      const url = match.threat?.url ?? urls[0] ?? ''
      const label = THREAT_LABELS[match.threatType ?? ''] ?? 'ameaça'
      return {
        code: 'blacklisted_safe_browsing',
        discriminator: url,
        severity: 'critical',
        title: `Google Safe Browsing marcou o site como ${label}`,
        detail:
          'O Chrome e o Firefox passam a mostrar um ecrã de aviso a quem tentar entrar, e o ' +
          'tráfego orgânico desaparece. Corrigir a causa e pedir revisão no Search Console.',
        evidence: { url, threatType: match.threatType, platformType: match.platformType },
      } satisfies ObservedFinding
    })
  } finally {
    clearTimeout(timer)
  }
}

interface UrlhausResponse {
  query_status?: string
  urls?: { url?: string; threat?: string; url_status?: string; date_added?: string }[]
}

/** URLhaus (abuse.ch): URLs do domínio conhecidos por distribuir malware. */
export async function queryUrlhaus(
  hostname: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
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

export const reputationCheck: CheckDefinition<ReputationConfig> = {
  type: 'reputation',
  defaultIntervalMinutes: 60 * 24,
  confirmationsRequired: 1,

  async run(context: CheckContext, config: ReputationConfig): Promise<CheckResult> {
    const timeoutMs = config.timeoutMs ?? 15_000
    const urls = [context.site.url, ...(config.additionalUrls ?? [])]

    const providers: { name: string; query: () => Promise<ObservedFinding[]> }[] = [
      {
        name: 'urlhaus',
        query: () => queryUrlhaus(context.site.hostname, context.fetch, timeoutMs),
      },
    ]

    if (config.safeBrowsingApiKey) {
      providers.unshift({
        name: 'safe_browsing',
        query: () =>
          querySafeBrowsing(urls, config.safeBrowsingApiKey as string, context.fetch, timeoutMs),
      })
    }

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

    return {
      findings,
      metrics: {
        providersQueried: providers.length,
        providersSucceeded: succeeded,
        listings: findings.length,
      },
    }
  },
}
