import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import { reputationCheck, type ReputationConfig } from './reputation.js'
import { mockFetch, testSite, type MockRoutes } from './test-utils.js'

const SAFE_BROWSING = 'https://safebrowsing.googleapis.com/v4/threatMatches:find?key=chave-teste'
const URLHAUS = 'https://urlhaus-api.abuse.ch/v1/host/'

async function run(routes: MockRoutes, config: ReputationConfig = {}) {
  const context: CheckContext = {
    site: testSite,
    now: new Date(),
    fetch: mockFetch(routes),
  }
  return runCheck(reputationCheck, context, config)
}

const CLEAN = {
  [SAFE_BROWSING]: { body: '{}' },
  [URLHAUS]: { body: JSON.stringify({ query_status: 'no_results' }) },
}

describe('reputationCheck', () => {
  it('não reporta nada com o domínio limpo', async () => {
    const outcome = await run(CLEAN, { safeBrowsingApiKey: 'chave-teste' })

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.providersSucceeded).toBe(2)
  })

  it('reporta uma marcação do Safe Browsing como crítica', async () => {
    const outcome = await run(
      {
        ...CLEAN,
        [SAFE_BROWSING]: {
          body: JSON.stringify({
            matches: [
              {
                threatType: 'SOCIAL_ENGINEERING',
                platformType: 'ANY_PLATFORM',
                threat: { url: 'https://cliente.pt/login' },
              },
            ],
          }),
        },
      },
      { safeBrowsingApiKey: 'chave-teste' },
    )

    expect(outcome.findings).toHaveLength(1)
    expect(outcome.findings[0]?.code).toBe('blacklisted_safe_browsing')
    expect(outcome.findings[0]?.severity).toBe('critical')
    expect(outcome.findings[0]?.title).toContain('phishing')
    expect(outcome.findings[0]?.discriminator).toBe('https://cliente.pt/login')
  })

  it('reporta URLs ativos do URLhaus', async () => {
    const outcome = await run({
      [URLHAUS]: {
        body: JSON.stringify({
          query_status: 'ok',
          urls: [
            { url: 'https://cliente.pt/wp-content/x.exe', threat: 'malware_download', url_status: 'online' },
          ],
        }),
      },
    })

    expect(outcome.findings[0]?.code).toBe('blacklisted_urlhaus')
    expect(outcome.findings[0]?.severity).toBe('critical')
  })

  it('ignora entradas do URLhaus já offline', async () => {
    const outcome = await run({
      [URLHAUS]: {
        body: JSON.stringify({
          query_status: 'ok',
          urls: [
            { url: 'https://cliente.pt/antigo.exe', threat: 'malware_download', url_status: 'offline' },
          ],
        }),
      },
    })

    // Histórico de um comprometimento já limpo não pode alertar todos os dias.
    expect(outcome.findings).toEqual([])
  })

  it('funciona sem chave do Safe Browsing, com cobertura reduzida', async () => {
    const outcome = await run(CLEAN)

    expect(outcome.status).toBe('ok')
    expect(outcome.metrics.providersQueried).toBe(1)
  })

  it('sobrevive à falha de um provider desde que outro responda', async () => {
    const outcome = await run(
      { ...CLEAN, [SAFE_BROWSING]: { status: 503 } },
      { safeBrowsingApiKey: 'chave-teste' },
    )

    expect(outcome.status).toBe('ok')
    expect(outcome.metrics.providersSucceeded).toBe(1)
  })

  it('falha o run quando nenhuma fonte responde', async () => {
    const outcome = await run(
      { [SAFE_BROWSING]: { status: 503 }, [URLHAUS]: { status: 500 } },
      { safeBrowsingApiKey: 'chave-teste' },
    )

    // Sem isto, a reconciliação marcaria uma blacklistagem real como resolvida
    // só porque as APIs estiveram em baixo.
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('Nenhuma fonte de reputação respondeu')
  })

  it('não confunde resposta malformada com domínio limpo', async () => {
    const outcome = await run({ [URLHAUS]: { body: 'isto não é JSON' } })
    expect(outcome.status).toBe('failed')
  })
})
