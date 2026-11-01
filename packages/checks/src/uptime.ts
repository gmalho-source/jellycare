import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import { classifyNetworkError, request } from './http.js'

export interface UptimeConfig {
  /**
   * Texto que tem de aparecer na resposta. Um site comprometido ou com a base
   * de dados em baixo devolve 200 na mesma — sem isto, o monitor diz que está
   * tudo bem enquanto o cliente vê uma página branca.
   */
  expectedContent?: string
  expectedStatus?: number
  slowThresholdMs?: number
  timeoutMs?: number
}

const DEFAULT_SLOW_THRESHOLD_MS = 3_000

/**
 * O conteúdo esperado está na resposta?
 *
 * A comparação ignora maiúsculas de propósito. A pergunta é "a página
 * verdadeira ainda está aqui", não "a caixa das letras continua igual": um
 * redesign que troque SCALLENT por Scallent não partiu nada, e tratá-lo como
 * conteúdo desaparecido dispara um alerta crítico sobre um site saudável.
 *
 * Foi exatamente isso que aconteceu no primeiro site real em produção.
 */
function containsExpected(body: string, expected: string): boolean {
  return body.toLowerCase().includes(expected.toLowerCase())
}

/**
 * Os cabeçalhos com que um CDN assina uma resposta da sua própria proteção.
 *
 * Quando estão presentes, o 403 ou o 429 não veio do site: veio da firewall
 * à frente dele, que decidiu que a nossa probe parecia um bot. Ver
 * `firewallBlock`.
 */
const MITIGATION_HEADERS = [
  { header: 'x-vercel-mitigated', provider: 'vercel', label: 'Vercel' },
  { header: 'cf-mitigated', provider: 'cloudflare', label: 'Cloudflare' },
] as const

export interface FirewallBlock {
  provider: (typeof MITIGATION_HEADERS)[number]['provider']
  label: string
  /** O valor do cabeçalho: `challenge`, `deny`, `rate_limit`… */
  action: string
}

/**
 * A resposta é a firewall do CDN a bloquear a probe?
 *
 * Só conta numa resposta de erro. Um 200 com o cabeçalho é a firewall a
 * deixar passar depois de um desafio, e esse pedido viu o site.
 */
export function firewallBlock(headers: Headers): FirewallBlock | null {
  for (const { header, provider, label } of MITIGATION_HEADERS) {
    const value = headers.get(header)
    if (value !== null) return { provider, label, action: value.trim() || 'blocked' }
  }
  return null
}

export const uptimeCheck: CheckDefinition<UptimeConfig> = {
  type: 'uptime',
  defaultIntervalMinutes: 5,
  // Nunca declarar downtime a partir de uma única observação: uma falha de rede
  // pontual entre a probe e o site não é o site em baixo.
  confirmationsRequired: 2,

  async run(context: CheckContext, config: UptimeConfig): Promise<CheckResult> {
    const findings: ObservedFinding[] = []
    const slowThreshold = config.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS

    let response
    try {
      response = await request(context.site.url, {
        timeoutMs: config.timeoutMs ?? 15_000,
        fetchImpl: context.fetch,
        ...(context.signal ? { signal: context.signal } : {}),
      })
    } catch (error) {
      // O site estar inacessível é uma observação válida, não uma falha do
      // check. Se isto propagasse, o run ficaria `failed` e a reconciliação
      // não conseguiria abrir nem fechar findings de disponibilidade.
      const { code, message } = classifyNetworkError(error)
      findings.push({
        code: 'site_down',
        severity: 'critical',
        title: `Site inacessível: ${message}`,
        detail: `Não foi possível obter ${context.site.url}.`,
        evidence: { reason: code, url: context.site.url },
      })
      return { findings, metrics: { up: 0 } }
    }

    const expectedStatus = config.expectedStatus
    const statusOk = expectedStatus
      ? response.status === expectedStatus
      : response.status >= 200 && response.status < 400

    const blocked = statusOk ? null : firewallBlock(response.headers)
    if (blocked) {
      // A borda do CDN respondeu e recusou-nos. Não sabemos se o site atrás
      // dela está de pé, por isso o run é inconclusivo: não conta como
      // indisponibilidade para o cliente, não resolve o que estava aberto, e
      // não grava tempo de resposta, que seria o da firewall e não o do site.
      //
      // Fica um finding próprio para a equipa: uma proteção que barra a
      // monitorização é para pôr em lista branca, e se for permanente o site
      // deixa de estar vigiado sem ninguém dar por isso.
      findings.push({
        code: 'monitor_blocked',
        discriminator: blocked.provider,
        severity: 'medium',
        title: `A proteção da ${blocked.label} bloqueou a verificação (HTTP ${response.status})`,
        detail:
          `A firewall da ${blocked.label} respondeu ${response.status} com a ação «${blocked.action}» ` +
          'em vez de deixar o pedido chegar ao site. O site não foi observado nesta verificação; ' +
          'não conta como indisponibilidade.',
        evidence: {
          reason: `firewall_${blocked.provider}`,
          provider: blocked.provider,
          action: blocked.action,
          status: response.status,
          finalUrl: response.finalUrl,
        },
      })
      return {
        findings,
        inconclusive: true,
        metrics: { blocked: 1, statusCode: response.status },
      }
    }

    if (!statusOk) {
      findings.push({
        code: 'site_down',
        severity: response.status >= 500 ? 'critical' : 'high',
        title: `Site responde HTTP ${response.status}`,
        detail: `Esperado ${expectedStatus ?? '2xx/3xx'}, obtido ${response.status}.`,
        evidence: {
          // O código vai na razão para chegar à amostra de disponibilidade e
          // dali à lista de interrupções. Sem isto a interrupção dizia apenas
          // `site_down`, que é o que já se sabia, e um 403 de uma firewall
          // ficava igual a um 503 de um servidor em baixo.
          reason: `http_${response.status}`,
          status: response.status,
          finalUrl: response.finalUrl,
          redirectChain: response.redirectChain,
        },
      })
    } else if (config.expectedContent && !containsExpected(response.body, config.expectedContent)) {
      findings.push({
        code: 'content_missing',
        severity: 'critical',
        title: 'O site responde mas o conteúdo esperado desapareceu',
        detail:
          `A resposta é ${response.status} mas não contém "${config.expectedContent}". ` +
          'Pode ser um deploy partido, a base de dados em baixo ou o site comprometido.',
        evidence: {
          status: response.status,
          expected: config.expectedContent,
          bodyLength: response.body.length,
        },
      })
    }

    if (statusOk && response.elapsedMs > slowThreshold) {
      findings.push({
        code: 'slow_response',
        severity: 'low',
        title: `Resposta lenta: ${(response.elapsedMs / 1000).toFixed(1)}s`,
        detail: `Acima do limiar de ${(slowThreshold / 1000).toFixed(1)}s.`,
        evidence: { elapsedMs: response.elapsedMs, threshold: slowThreshold },
      })
    }

    return {
      findings,
      metrics: {
        up: findings.some((f) => f.code === 'site_down' || f.code === 'content_missing') ? 0 : 1,
        responseTimeMs: response.elapsedMs,
        statusCode: response.status,
        redirectHops: response.redirectChain.length,
      },
    }
  },
}
