import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import { reputationCheck, type ReputationConfig } from './reputation.js'
import { mockFetch, testSite, type MockRoutes } from './test-utils.js'

const SAFE_BROWSING = 'https://safebrowsing.googleapis.com/v4/threatMatches:find?key=chave-teste'
const URLHAUS = 'https://urlhaus-api.abuse.ch/v1/host/'

/** As duas fontes configuradas: é o cenário normal em produção. */
const AMBAS: ReputationConfig = {
  safeBrowsingApiKey: 'chave-teste',
  urlhausAuthKey: 'chave-urlhaus',
}

async function run(routes: MockRoutes, config: ReputationConfig = AMBAS) {
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
    const outcome = await run(CLEAN, AMBAS)

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
      AMBAS,
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
    const outcome = await run(CLEAN, { urlhausAuthKey: 'chave-urlhaus' })

    expect(outcome.status).toBe('ok')
    expect(outcome.metrics.providersQueried).toBe(1)
  })

  it('salta a fonte sem credenciais em vez de a dar por falhada', async () => {
    // O URLhaus passou a exigir autenticação. Chamá-lo sem chave devolvia 401
    // e contava como falha, o que arrastava o check inteiro para failed mesmo
    // com o Safe Browsing a responder bem.
    const outcome = await run(CLEAN, { safeBrowsingApiKey: 'chave-teste' })

    expect(outcome.status).toBe('ok')
    expect(outcome.metrics.providersQueried).toBe(1)
    expect(outcome.metrics.providersSucceeded).toBe(1)
  })

  it('falha, dizendo o que configurar, quando não há fonte nenhuma', async () => {
    const outcome = await run(CLEAN, {})

    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('GOOGLE_SAFE_BROWSING_API_KEY')
  })

  it('autentica no URLhaus com a chave da abuse.ch', async () => {
    const pedidos: { url: string; authKey: string | null }[] = []
    const context = {
      site: testSite,
      now: new Date(),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        pedidos.push({ url: String(input), authKey: headers.get('Auth-Key') })
        return new Response(JSON.stringify({ query_status: 'no_results' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof globalThis.fetch,
    }

    await runCheck(reputationCheck, context, { urlhausAuthKey: 'chave-urlhaus' })

    expect(pedidos.some((p) => p.authKey === 'chave-urlhaus')).toBe(true)
  })

  it('avisa quando uma fonte falha e a outra responde', async () => {
    // O caso que estava a passar em silêncio: o check diz `ok`, metade da
    // cobertura desapareceu, e ninguém fica a saber. Não é um problema do
    // site do cliente — não vira finding — mas é um defeito da plataforma
    // que alguém tem de corrigir.
    const outcome = await run({ ...CLEAN, [SAFE_BROWSING]: { status: 400 } })

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.warnings?.length).toBe(1)
    expect(outcome.warnings?.[0]).toContain('safe_browsing')
    expect(outcome.metrics.providersFailed).toBe(1)
  })

  it('não inventa avisos quando corre tudo bem', async () => {
    const outcome = await run(CLEAN)

    expect(outcome.warnings ?? []).toEqual([])
    expect(outcome.metrics.providersFailed).toBe(0)
  })

  it('o aviso diz o que a fonte respondeu', async () => {
    // Sem isto o aviso era "uma fonte falhou" e obrigava a ir ao painel da
    // Google adivinhar qual e porquê.
    const outcome = await run({
      ...CLEAN,
      [SAFE_BROWSING]: { status: 400, body: '{"error":{"message":"API key not valid"}}' },
    })

    expect(outcome.warnings?.[0]).toContain('API key not valid')
  })

  it('sobrevive à falha de um provider desde que outro responda', async () => {
    const outcome = await run(
      { ...CLEAN, [SAFE_BROWSING]: { status: 503 } },
      AMBAS,
    )

    expect(outcome.status).toBe('ok')
    expect(outcome.metrics.providersSucceeded).toBe(1)
  })

  it('falha o run quando nenhuma fonte responde', async () => {
    const outcome = await run(
      { [SAFE_BROWSING]: { status: 503 }, [URLHAUS]: { status: 500 } },
      AMBAS,
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
