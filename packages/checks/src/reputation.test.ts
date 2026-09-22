import { runCheck, type CheckContext, type ObservedFinding } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import {
  aggregateProviders,
  reputationCheck,
  type ReputationConfig,
  type ReputationProvider,
} from './reputation.js'
import { mockFetch, testSite, type MockRoutes } from './test-utils.js'

const URLHAUS = 'https://urlhaus-api.abuse.ch/v1/host/'

/** A fonte configurada: é o cenário normal em produção. */
const CONFIG: ReputationConfig = { urlhausAuthKey: 'chave-urlhaus' }

async function run(routes: MockRoutes, config: ReputationConfig = CONFIG) {
  const context: CheckContext = {
    site: testSite,
    now: new Date(),
    fetch: mockFetch(routes),
  }
  return runCheck(reputationCheck, context, config)
}

const CLEAN = {
  [URLHAUS]: { body: JSON.stringify({ query_status: 'no_results' }) },
}

describe('reputationCheck', () => {
  it('não reporta nada com o domínio limpo', async () => {
    const outcome = await run(CLEAN)

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.providersSucceeded).toBe(1)
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

  it('não vai à Safe Browsing da Google', async () => {
    // Foi implementada e retirada: os termos da API v4 dizem "for
    // non-commercial use only" e o Jellycare é vendido. Este teste existe
    // para a remoção não ser desfeita sem querer.
    const fetch = mockFetch(CLEAN)
    const context: CheckContext = { site: testSite, now: new Date(), fetch }
    await runCheck(reputationCheck, context, {
      ...CONFIG,
      // Uma config antiga, com a chave que já não existe, não pode fazer o
      // check voltar a chamar a Google.
      ...({ safeBrowsingApiKey: 'chave-antiga' } as Record<string, string>),
    })

    expect(fetch.calls.some((url) => url.includes('safebrowsing'))).toBe(false)
    expect(fetch.calls.some((url) => url.includes('googleapis'))).toBe(false)
  })

  it('salta a fonte sem credenciais em vez de a dar por falhada', async () => {
    // O URLhaus passou a exigir autenticação. Chamá-lo sem chave devolvia 401
    // e contava como falha, o que arrastava o check inteiro para failed.
    const fetch = mockFetch(CLEAN)
    const context: CheckContext = { site: testSite, now: new Date(), fetch }
    const outcome = await runCheck(reputationCheck, context, {})

    expect(fetch.calls).toEqual([])
    expect(outcome.status).toBe('failed')
  })

  it('falha, dizendo o que configurar, quando não há fonte nenhuma', async () => {
    const outcome = await run(CLEAN, {})

    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('URLHAUS_AUTH_KEY')
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

    await runCheck(reputationCheck, context, CONFIG)

    expect(pedidos.some((p) => p.authKey === 'chave-urlhaus')).toBe(true)
  })

  it('não inventa avisos quando corre tudo bem', async () => {
    const outcome = await run(CLEAN)

    expect(outcome.warnings ?? []).toEqual([])
    expect(outcome.metrics.providersFailed).toBe(0)
  })

  it('falha o run quando a fonte não responde', async () => {
    const outcome = await run({ [URLHAUS]: { status: 500 } })

    // Sem isto, a reconciliação marcaria uma blacklistagem real como resolvida
    // só porque a API esteve em baixo.
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('Nenhuma fonte de reputação respondeu')
  })

  it('não confunde resposta malformada com domínio limpo', async () => {
    const outcome = await run({ [URLHAUS]: { body: 'isto não é JSON' } })
    expect(outcome.status).toBe('failed')
  })
})

/**
 * A regra que hoje tem uma fonte só para a exercitar.
 *
 * Com o Safe Browsing removido sobrou um provider, e por um provider a
 * diferença entre «falhou uma» e «falharam todas» desaparece. Estes testes
 * usam fontes de mentira para a regra ficar escrita e verificada antes de a
 * próxima fonte real chegar — foi a ausência dela que deixou passar, em
 * silêncio, meia cobertura perdida.
 */
describe('aggregateProviders', () => {
  const listagem: ObservedFinding = {
    code: 'blacklisted_urlhaus',
    discriminator: 'https://cliente.pt/x.exe',
    severity: 'critical',
    title: 'Listado',
    detail: '',
    evidence: {},
  }

  const boa = (findings: ObservedFinding[] = []): ReputationProvider => ({
    name: 'boa',
    query: async () => findings,
  })

  const ma = (mensagem = 'respondeu 400'): ReputationProvider => ({
    name: 'ma',
    query: async () => {
      throw new Error(mensagem)
    },
  })

  it('avisa quando uma fonte falha e a outra responde', async () => {
    const resultado = await aggregateProviders([boa(), ma()])

    expect(resultado.warnings).toHaveLength(1)
    expect(resultado.warnings?.[0]).toContain('ma')
    expect(resultado.metrics?.providersFailed).toBe(1)
    expect(resultado.metrics?.providersSucceeded).toBe(1)
  })

  it('o aviso diz o que a fonte respondeu', async () => {
    // Sem isto o aviso era "uma fonte falhou" e obrigava a ir ao painel do
    // fornecedor adivinhar qual e porquê.
    const resultado = await aggregateProviders([boa(), ma('API key not valid')])

    expect(resultado.warnings?.[0]).toContain('API key not valid')
  })

  it('não deita fora o que a fonte que respondeu encontrou', async () => {
    // O caso que justifica a regra: uma chave mal configurada numa fonte não
    // pode apagar uma blacklistagem verdadeira que a outra viu.
    const resultado = await aggregateProviders([boa([listagem]), ma()])

    expect(resultado.findings).toEqual([listagem])
  })

  it('falha quando nenhuma responde, em vez de dar o domínio por limpo', async () => {
    await expect(aggregateProviders([ma('503'), ma('500')])).rejects.toThrow(
      'Nenhuma fonte de reputação respondeu',
    )
  })
})
