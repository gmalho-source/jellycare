import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import { USER_AGENT } from '@jellycare/core'

export interface ReputationConfig {
  /** Chave da abuse.ch. Sem ela o URLhaus responde 401 e é saltado. */
  urlhausAuthKey?: string
  /** Chave da Google Web Risk, da conta Google Cloud da plataforma. */
  webRiskApiKey?: string
  timeoutMs?: number
  /** Páginas adicionais a submeter, além da homepage. */
  additionalUrls?: string[]
}

export interface ProviderResult {
  provider: string
  findings: ObservedFinding[]
}

const URLHAUS_ENDPOINT = 'https://urlhaus-api.abuse.ch/v1/host/'
const WEB_RISK_ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search'

/**
 * As listas da Web Risk que interessam: malware, phishing e software
 * indesejado. São as que fazem o Chrome mostrar o ecrã vermelho antes de
 * entrar no site.
 */
const WEB_RISK_THREATS = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'] as const

/** No máximo, por site e por passagem: a Web Risk cobra por consulta acima da quota grátis. */
const WEB_RISK_MAX_URLS = 10

const AMEACA: Record<string, string> = {
  MALWARE: 'distribuição de malware',
  SOCIAL_ENGINEERING: 'phishing ou engenharia social',
  UNWANTED_SOFTWARE: 'software indesejado',
}

/*
 * Porque é que a Google Safe Browsing não está aqui, e a Web Risk está.
 *
 * Foi implementada e retirada. Os termos da API v4 dizem "for non-commercial
 * use only", e o Jellycare é vendido — usá-la era violar a licença de um
 * fornecedor para vender um serviço de segurança, o que não se faz nem se
 * explica a um cliente. A Web Risk é a mesma base de dados com licença
 * comercial: grátis até 100 000 consultas por mês e paga por consulta acima
 * disso.
 *
 * Fica escrito para ninguém voltar a pôr a Safe Browsing por parecer óbvia.
 * Ver docs/checks.md.
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

interface WebRiskResponse {
  threat?: { threatTypes?: string[]; expireTime?: string }
}

/**
 * Google Web Risk: as páginas do site estão nas listas que o Chrome usa?
 *
 * Uma consulta por URL — a API não aceita lotes. Um URL marcado é incidente
 * crítico: o Chrome passa a mostrar o aviso vermelho antes de entrar, e é
 * isso que tira o site da pesquisa e afasta quem lá ia.
 *
 * A chave viaja na query, como a API exige. O erro nunca leva o URL do pedido
 * — só o estado e o motivo que a Google devolve no corpo — para a chave não
 * acabar gravada no aviso da execução.
 */
export async function queryWebRisk(
  urls: readonly string[],
  apiKey: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<ObservedFinding[]> {
  const findings: ObservedFinding[] = []

  for (const url of urls.slice(0, WEB_RISK_MAX_URLS)) {
    const query = new URLSearchParams({ uri: url, key: apiKey })
    for (const ameaca of WEB_RISK_THREATS) query.append('threatTypes', ameaca)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${WEB_RISK_ENDPOINT}?${query.toString()}`, {
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT },
      })

      if (!response.ok) {
        // A Google explica no corpo o que está mal: uma chave sem a API
        // ativada volta 403 com o texto a dizê-lo.
        const detalhe = await response
          .text()
          .then((texto) => texto.slice(0, 300).replace(/\s+/g, ' ').trim())
          .catch(() => '')
        throw new Error(`Web Risk respondeu ${response.status}${detalhe ? `: ${detalhe}` : ''}`)
      }

      const body = (await response.json()) as WebRiskResponse
      const tipos = body.threat?.threatTypes ?? []
      if (tipos.length === 0) continue

      findings.push({
        code: 'blacklisted_web_risk',
        discriminator: url,
        severity: 'critical',
        title: 'Página do site marcada pela Google como perigosa',
        detail: `A Google lista esta página por ${tipos.map((tipo) => AMEACA[tipo] ?? tipo).join(' e ')}. O Chrome mostra um aviso antes de a abrir.`,
        evidence: { url, threatTypes: tipos },
      })
    } finally {
      clearTimeout(timer)
    }
  }

  return findings
}

/** A homepage e as páginas declaradas, sem repetidos. */
function urlsParaVerificar(siteUrl: string, adicionais: readonly string[] = []): string[] {
  const vistos = new Set<string>()
  const lista: string[] = []
  for (const url of [siteUrl, ...adicionais]) {
    const chave = url.replace(/\/+$/, '')
    if (vistos.has(chave)) continue
    vistos.add(chave)
    lista.push(url)
  }
  return lista
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

    if (config.webRiskApiKey) {
      const apiKey = config.webRiskApiKey
      providers.push({
        name: 'web-risk',
        query: () =>
          queryWebRisk(
            urlsParaVerificar(context.site.url, config.additionalUrls),
            apiKey,
            context.fetch,
            timeoutMs,
          ),
      })
    }

    if (providers.length === 0) {
      throw new NoReputationDataError([
        'nenhuma fonte configurada: defina URLHAUS_AUTH_KEY ou WEB_RISK_API_KEY',
      ])
    }

    return aggregateProviders(providers)
  },
}
