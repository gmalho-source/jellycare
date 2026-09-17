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

    if (!statusOk) {
      findings.push({
        code: 'site_down',
        severity: response.status >= 500 ? 'critical' : 'high',
        title: `Site responde HTTP ${response.status}`,
        detail: `Esperado ${expectedStatus ?? '2xx/3xx'}, obtido ${response.status}.`,
        evidence: {
          status: response.status,
          finalUrl: response.finalUrl,
          redirectChain: response.redirectChain,
        },
      })
    } else if (config.expectedContent && !response.body.includes(config.expectedContent)) {
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
