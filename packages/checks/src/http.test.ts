import { describe, expect, it } from 'vitest'
import { classifyNetworkError } from './http.js'
import { networkError } from './test-utils.js'

/**
 * As formas de erro abaixo são as que o `fetch` do Node 22 devolve de facto,
 * medidas contra ligações reais: uma porta fechada, um servidor que fecha a
 * ligação, e uma regra de firewall que descarta os pacotes.
 */
describe('classifyNetworkError', () => {
  it('chama ao descarte de ligações pelo nome, e não «network_error»', () => {
    // O que uma firewall que pôs o IP da probe na lista negra provoca: o
    // undici desiste ao fim de 10 s, antes do nosso próprio timeout.
    const error = new TypeError('fetch failed')
    ;(error as TypeError & { cause: unknown }).cause = Object.assign(
      new Error('Connect Timeout Error (attempted address: 185.31.158.162:443, timeout: 10000ms)'),
      { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' },
    )

    const result = classifyNetworkError(error)
    expect(result.code).toBe('connect_timeout')
    expect(result.message).toContain('firewall')
  })

  it('trata o servidor que fecha a ligação como ligação terminada', () => {
    expect(classifyNetworkError(networkError('UND_ERR_SOCKET')).code).toBe('connection_reset')
    expect(classifyNetworkError(networkError('ECONNRESET')).code).toBe('connection_reset')
  })

  it('distingue a falta de caminho de rede', () => {
    expect(classifyNetworkError(networkError('EHOSTUNREACH')).code).toBe('host_unreachable')
    expect(classifyNetworkError(networkError('ENETUNREACH')).code).toBe('host_unreachable')
  })

  it('lê o código dentro de um AggregateError, quando o host tem vários endereços', () => {
    const error = new TypeError('fetch failed')
    ;(error as TypeError & { cause: unknown }).cause = new AggregateError([
      Object.assign(new Error('connect ETIMEDOUT 2001:db8::1:443'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('connect ETIMEDOUT 192.0.2.1:443'), { code: 'ETIMEDOUT' }),
    ])

    expect(classifyNetworkError(error).code).toBe('connect_timeout')
  })

  it('apanha a cadeia de certificados incompleta como falha TLS', () => {
    // Os browsers vão buscar o intermédio em falta; o Node não. Para quem
    // visita o site abre; para a probe, não — e não é «erro de rede».
    expect(classifyNetworkError(networkError('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')).code).toBe(
      'tls_failure',
    )
    expect(classifyNetworkError(networkError('DEPTH_ZERO_SELF_SIGNED_CERT')).code).toBe(
      'tls_failure',
    )
  })

  it('o servidor que aceita e não responde é timeout', () => {
    expect(classifyNetworkError(networkError('UND_ERR_HEADERS_TIMEOUT')).code).toBe('timeout')
  })

  it('o que não reconhece leva o código cru na mensagem', () => {
    const result = classifyNetworkError(networkError('EPROTO'))
    expect(result.code).toBe('network_error')
    expect(result.message).toBe('fetch failed (EPROTO)')
  })

  it('não confunde o código de um erro nosso com a causa de rede', () => {
    const ours = Object.assign(new Error('Ciclo de redirects detetado'), { code: 'redirect_loop' })
    expect(classifyNetworkError(ours)).toEqual({
      code: 'network_error',
      message: 'Ciclo de redirects detetado',
    })
  })
})
