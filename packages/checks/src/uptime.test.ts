import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import { mockFetch, networkError, testSite, type MockRoutes } from './test-utils.js'
import { uptimeCheck, type UptimeConfig } from './uptime.js'

function context(routes: MockRoutes): CheckContext {
  return { site: testSite, now: new Date(), fetch: mockFetch(routes) }
}

async function run(routes: MockRoutes, config: UptimeConfig = {}) {
  return runCheck(uptimeCheck, context(routes), config)
}

describe('uptimeCheck', () => {
  it('não reporta nada quando o site responde bem', async () => {
    const outcome = await run({ 'https://cliente.pt': { body: '<h1>Cliente</h1>' } })

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toHaveLength(0)
    expect(outcome.metrics.up).toBe(1)
    expect(outcome.metrics.statusCode).toBe(200)
  })

  it('trata o site inacessível como observação, não como falha do check', async () => {
    const outcome = await run({
      'https://cliente.pt': { error: networkError('ECONNREFUSED') },
    })

    // Crítico: se o run ficasse `failed`, a reconciliação não abria o finding
    // de downtime nem o fechava quando o site voltasse.
    expect(outcome.status).toBe('ok')
    expect(outcome.findings[0]?.code).toBe('site_down')
    expect(outcome.findings[0]?.severity).toBe('critical')
    expect(outcome.metrics.up).toBe(0)
  })

  it('distingue a causa da indisponibilidade', async () => {
    const dns = await run({ 'https://cliente.pt': { error: networkError('ENOTFOUND') } })
    expect(dns.findings[0]?.evidence).toMatchObject({ reason: 'dns_failure' })

    const tls = await run({ 'https://cliente.pt': { error: networkError('CERT_HAS_EXPIRED') } })
    expect(tls.findings[0]?.evidence).toMatchObject({ reason: 'tls_failure' })
  })

  it('separa erro do servidor de erro do cliente na severidade', async () => {
    const server = await run({ 'https://cliente.pt': { status: 503 } })
    expect(server.findings[0]?.severity).toBe('critical')

    const client = await run({ 'https://cliente.pt': { status: 403 } })
    expect(client.findings[0]?.severity).toBe('high')
  })

  it('apanha o site que responde 200 mas perdeu o conteúdo', async () => {
    const outcome = await run(
      { 'https://cliente.pt': { body: '<html><body></body></html>' } },
      { expectedContent: 'Cliente' },
    )

    expect(outcome.findings[0]?.code).toBe('content_missing')
    expect(outcome.findings[0]?.severity).toBe('critical')
    expect(outcome.metrics.up).toBe(0)
  })

  it('aceita o conteúdo esperado quando está presente', async () => {
    const outcome = await run(
      { 'https://cliente.pt': { body: '<h1>Cliente</h1>' } },
      { expectedContent: 'Cliente' },
    )

    expect(outcome.findings).toHaveLength(0)
  })

  it('segue redirects e conta os saltos', async () => {
    const outcome = await run({
      'https://cliente.pt': { status: 301, headers: { location: 'https://cliente.pt/pt' } },
      'https://cliente.pt/pt': { body: 'ok' },
    })

    expect(outcome.findings).toHaveLength(0)
    expect(outcome.metrics.redirectHops).toBe(1)
  })

  it('deteta ciclos de redirect em vez de ficar preso', async () => {
    const outcome = await run({
      'https://cliente.pt': { status: 302, headers: { location: 'https://cliente.pt/a' } },
      'https://cliente.pt/a': { status: 302, headers: { location: 'https://cliente.pt' } },
    })

    expect(outcome.findings[0]?.code).toBe('site_down')
    expect(outcome.metrics.up).toBe(0)
  })

  it('assinala lentidão sem a confundir com indisponibilidade', async () => {
    const outcome = await run(
      { 'https://cliente.pt': { body: 'ok', delayMs: 60 } },
      { slowThresholdMs: 20 },
    )

    expect(outcome.findings).toHaveLength(1)
    expect(outcome.findings[0]?.code).toBe('slow_response')
    expect(outcome.findings[0]?.severity).toBe('low')
    expect(outcome.metrics.up).toBe(1)
  })

  it('exige duas observações antes de notificar downtime', () => {
    expect(uptimeCheck.confirmationsRequired).toBe(2)
  })
})
