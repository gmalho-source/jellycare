import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import {
  capturaFinal,
  measurePageSpeed,
  pageSpeedCheck,
  pageSpeedDesktopCheck,
  type PageSpeedConfig,
} from './page-speed.js'
import { mockFetch, testSite, type MockRoutes } from './test-utils.js'

const CLASSICAS =
  'https://www.googleapis.com/pagespeedonline/v5/runPagespeed' +
  '?url=https%3A%2F%2Fcliente.pt&key=chave-teste&strategy=mobile' +
  '&category=performance&category=accessibility&category=best-practices&category=seo'

/** O pedido como sai: as quatro categorias clássicas e a navegação com agência. */
const ENDPOINT = `${CLASSICAS}&category=agentic-browsing`

const CONFIG: PageSpeedConfig = { apiKey: 'chave-teste' }

/**
 * Uma resposta da PageSpeed com os valores que interessam. Os nomes das
 * auditorias são os reais: se a Google os mudar, é aqui que se parte.
 */
function resposta({
  score,
  lcp = 1800,
  cls = 0.02,
  tbt = 80,
}: {
  score: number | null
  lcp?: number
  cls?: number
  tbt?: number
}) {
  return JSON.stringify({
    lighthouseResult: {
      categories: { performance: { score } },
      audits: {
        'largest-contentful-paint': { numericValue: lcp },
        'cumulative-layout-shift': { numericValue: cls },
        'total-blocking-time': { numericValue: tbt },
        'first-contentful-paint': { numericValue: 1200 },
        'speed-index': { numericValue: 2400 },
      },
    },
  })
}

async function run(routes: MockRoutes, config: PageSpeedConfig = CONFIG) {
  const context: CheckContext = {
    site: testSite,
    now: new Date(),
    fetch: mockFetch(routes),
  }
  return runCheck(pageSpeedCheck, context, config)
}

describe('pageSpeedCheck', () => {
  it('não reporta nada quando a página é rápida', async () => {
    const outcome = await run({ [ENDPOINT]: { body: resposta({ score: 0.95 }) } })

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.performanceScore).toBe(95)
    expect(outcome.metrics.lcpMs).toBe(1800)
  })

  it('guarda as outras categorias junto da de desempenho', async () => {
    const outcome = await run({
      [ENDPOINT]: {
        body: JSON.stringify({
          lighthouseResult: {
            categories: {
              performance: { score: 0.95 },
              accessibility: { score: 0.88 },
              'best-practices': { score: 0.96 },
              seo: { score: 0.91 },
              'agentic-browsing': { auditRefs: [{ id: 'llms-txt', weight: 1 }] },
            },
            audits: { 'llms-txt': { score: 1, scoreDisplayMode: 'binary' } },
          },
        }),
      },
    })

    expect(outcome.metrics).toMatchObject({
      performanceScore: 95,
      accessibilityScore: 88,
      bestPracticesScore: 96,
      seoScore: 91,
      agenticPassed: 1,
      agenticTotal: 1,
    })
  })

  it('guarda a pontuação em 0–100 e não em 0–1', async () => {
    const outcome = await run({ [ENDPOINT]: { body: resposta({ score: 0.42 }) } })

    expect(outcome.metrics.performanceScore).toBe(42)
  })

  it('reporta uma página lenta e nomeia o que está a pesar', async () => {
    const outcome = await run({
      [ENDPOINT]: { body: resposta({ score: 0.31, lcp: 6200, cls: 0.34, tbt: 900 }) },
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toHaveLength(1)

    const finding = outcome.findings[0]
    expect(finding?.code).toBe('page_speed_poor')
    expect(finding?.severity).toBe('medium')
    expect(finding?.discriminator).toBe('mobile')
    expect(finding?.detail).toContain('6.2 s')
    expect(finding?.detail).toContain('CLS 0.34')
    expect(finding?.detail).toContain('900 ms')
  })

  it('um desempenho medíocre é baixo, não médio', async () => {
    const outcome = await run({
      [ENDPOINT]: { body: resposta({ score: 0.72, lcp: 3100 }) },
    })

    expect(outcome.findings[0]?.severity).toBe('low')
  })

  it('um único finding cobre as três métricas más', async () => {
    const outcome = await run({
      [ENDPOINT]: { body: resposta({ score: 0.2, lcp: 8000, cls: 0.5, tbt: 2000 }) },
    })

    // Três alertas para uma causa é a forma mais rápida de ensinar alguém a
    // ignorá-los.
    expect(outcome.findings).toHaveLength(1)
  })

  it('falha em voz alta quando a chave não está definida', async () => {
    const outcome = await run({}, {})

    expect(outcome.status).toBe('failed')
    // O nome exato da variável, para que um segredo mal nomeado apareça na
    // primeira execução em vez de ficar guardado em silêncio.
    expect(outcome.error).toContain('GOOGLE_PAGESPEED_API_KEY')
  })

  it('não chega a pedir nada à Google sem chave', async () => {
    const fetch = mockFetch({})
    const context: CheckContext = { site: testSite, now: new Date(), fetch }
    await runCheck(pageSpeedCheck, context, {})

    expect(fetch.calls).toEqual([])
  })

  it('falha sem pontuação em vez de dar a página por boa', async () => {
    const outcome = await run({ [ENDPOINT]: { body: resposta({ score: null }) } })

    // Um "ok" sem findings faria a reconciliação fechar um problema de
    // desempenho real só porque o Lighthouse não carregou a página.
    expect(outcome.status).toBe('failed')
    expect(outcome.findings).toEqual([])
  })

  it('leva o motivo da Google no erro quando a API recusa', async () => {
    const outcome = await run({
      [ENDPOINT]: {
        status: 403,
        body: JSON.stringify({ error: { message: 'PageSpeed Insights API has not been used' } }),
      },
    })

    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('403')
    expect(outcome.error).toContain('has not been used')
  })

  it('a chave não aparece no erro', async () => {
    const outcome = await run({ [ENDPOINT]: { status: 500, body: 'erro interno' } })

    expect(outcome.error).not.toContain('chave-teste')
  })

  it('a verificação de computador mede computador e guarda a pontuação', async () => {
    // A estratégia está presa ao tipo de verificação. Se viesse da
    // configuração do site, uma configuração errada punha esta a medir
    // telemóvel e a escrever no histórico do computador.
    const desktop = ENDPOINT.replace('strategy=mobile', 'strategy=desktop')
    const fetch = mockFetch({ [desktop]: { body: resposta({ score: 0.4 }) } })
    const context: CheckContext = { site: testSite, now: new Date(), fetch }
    const outcome = await runCheck(pageSpeedDesktopCheck, context, CONFIG)

    expect(outcome.status).toBe('ok')
    expect(outcome.metrics.performanceScore).toBe(40)
  })

  it('o computador mede mas não abre problemas', async () => {
    // Uma pontuação de 40 em telemóvel abre um problema médio. Em computador
    // não abre nenhum: ligá-lo faria nascer um problema em todos os sites com
    // computador lento no dia em que esta verificação entrou.
    const desktop = ENDPOINT.replace('strategy=mobile', 'strategy=desktop')
    const fetch = mockFetch({ [desktop]: { body: resposta({ score: 0.4 }) } })
    const context: CheckContext = { site: testSite, now: new Date(), fetch }
    const outcome = await runCheck(pageSpeedDesktopCheck, context, CONFIG)

    expect(outcome.findings).toHaveLength(0)

    // E o telemóvel continua a abrir, para o teste provar a diferença e não
    // apenas a ausência.
    const movel = await run({ [ENDPOINT]: { body: resposta({ score: 0.4 }) } })
    expect(movel.findings[0]?.discriminator).toBe('mobile')
    expect(movel.findings[0]?.title).toContain('telemóvel')
  })

  it('mede o URL configurado e não sempre a homepage', async () => {
    const outro = ENDPOINT.replace(
      'url=https%3A%2F%2Fcliente.pt',
      'url=https%3A%2F%2Fcliente.pt%2Floja',
    )
    const fetch = mockFetch({ [outro]: { body: resposta({ score: 0.9 }) } })
    const context: CheckContext = { site: testSite, now: new Date(), fetch }
    const outcome = await runCheck(pageSpeedCheck, context, {
      ...CONFIG,
      url: 'https://cliente.pt/loja',
    })

    expect(outcome.status).toBe('ok')
    expect(fetch.calls[0]).toContain('cliente.pt%2Floja')
  })
})

describe('measurePageSpeed', () => {
  it('devolve nulo nas auditorias que a resposta não traz', async () => {
    const fetch = mockFetch({
      [ENDPOINT]: {
        body: JSON.stringify({
          lighthouseResult: { categories: { performance: { score: 0.8 } }, audits: {} },
        }),
      },
    })

    const medicao = await measurePageSpeed(
      'https://cliente.pt',
      'chave-teste',
      'mobile',
      fetch,
      5000,
    )

    expect(medicao.score).toBe(80)
    expect(medicao.lcpMs).toBeNull()
    expect(medicao.cls).toBeNull()
    // As outras categorias também: uma que não veio é nula, não é zero.
    expect(medicao.accessibility).toBeNull()
    expect(medicao.agentic).toBeNull()
  })

  it('lê as quatro pontuações e a fração da navegação com agência', async () => {
    const fetch = mockFetch({
      [ENDPOINT]: {
        body: JSON.stringify({
          lighthouseResult: {
            categories: {
              performance: { score: 0.72 },
              accessibility: { score: 0.95 },
              'best-practices': { score: 1 },
              seo: { score: 1 },
              'agentic-browsing': {
                score: null,
                auditRefs: [
                  { id: 'agent-accessibility-tree', weight: 1, group: 'agent-accessibility' },
                  { id: 'webmcp-form-coverage', weight: 1, group: 'webmcp' },
                  { id: 'webmcp-schema-validity', weight: 1, group: 'webmcp' },
                  { id: 'cumulative-layout-shift', weight: 1 },
                  { id: 'llms-txt', weight: 1, group: 'agent-discoverability' },
                  { id: 'ard-schema', weight: 1, group: 'hidden' },
                ],
              },
            },
            audits: {
              'agent-accessibility-tree': { score: 1, scoreDisplayMode: 'binary' },
              // Um site sem formulários anotados: não aplicável, não conta.
              'webmcp-form-coverage': { score: null, scoreDisplayMode: 'notApplicable' },
              'webmcp-schema-validity': { score: null, scoreDisplayMode: 'notApplicable' },
              // O CLS entra com a nota numérica: 0,9 ou mais é passar.
              'cumulative-layout-shift': { score: 0.93, scoreDisplayMode: 'numeric' },
              'llms-txt': { score: 0, scoreDisplayMode: 'binary' },
              'ard-schema': { score: 0, scoreDisplayMode: 'binary' },
            },
          },
        }),
      },
    })

    const medicao = await measurePageSpeed('https://cliente.pt', 'chave-teste', 'mobile', fetch, 5000)

    expect(medicao.score).toBe(72)
    expect(medicao.accessibility).toBe(95)
    expect(medicao.bestPractices).toBe(100)
    expect(medicao.seo).toBe(100)
    // Três aplicáveis e visíveis — árvore, CLS e llms.txt —, duas passadas.
    expect(medicao.agentic).toEqual({ passed: 2, total: 3 })
  })

  it('mede na mesma quando a API ainda não conhece a navegação com agência', async () => {
    // A documentação da API ainda não lista a categoria. Se a recusar, perde-se
    // o indicador experimental e não a medição inteira.
    const fetch = mockFetch({
      [ENDPOINT]: {
        status: 400,
        body: JSON.stringify({
          error: { message: 'Invalid value at \'category[4]\' (TYPE_ENUM), "agentic-browsing"' },
        }),
      },
      [CLASSICAS]: { body: resposta({ score: 0.9 }) },
    })

    const medicao = await measurePageSpeed('https://cliente.pt', 'chave-teste', 'mobile', fetch, 5000)

    expect(medicao.score).toBe(90)
    expect(medicao.agentic).toBeNull()
    expect(fetch.calls).toHaveLength(2)
  })

  it('não repete o pedido quando a recusa não tem nada a ver com a categoria nova', async () => {
    const fetch = mockFetch({
      [ENDPOINT]: { status: 400, body: JSON.stringify({ error: { message: 'Invalid url' } }) },
      [CLASSICAS]: { body: resposta({ score: 0.9 }) },
    })

    await expect(
      measurePageSpeed('https://cliente.pt', 'chave-teste', 'mobile', fetch, 5000),
    ).rejects.toThrow('Invalid url')
    expect(fetch.calls).toHaveLength(1)
  })

  it('desiste ao fim do tempo em vez de ficar pendurado', async () => {
    const fetch = mockFetch({ [ENDPOINT]: { delayMs: 500, body: resposta({ score: 0.9 }) } })

    await expect(
      measurePageSpeed('https://cliente.pt', 'chave-teste', 'mobile', fetch, 20),
    ).rejects.toThrow()
  })
})

describe('captura da página', () => {
  // Os primeiros bytes de um JPEG verdadeiro, chega para o que se testa.
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
  const comCaptura = (data: string) =>
    JSON.stringify({
      lighthouseResult: {
        categories: { performance: { score: 0.95 } },
        audits: {
          'largest-contentful-paint': { numericValue: 1800 },
          'final-screenshot': { details: { type: 'screenshot', data } },
        },
      },
    })

  it('devolve a imagem que o Lighthouse tirou no fim da medição', async () => {
    const outcome = await run({
      [ENDPOINT]: { body: comCaptura(`data:image/jpeg;base64,${JPEG.toString('base64')}`) },
    })
    expect(outcome.status).toBe('ok')
    expect(outcome.capture?.mimeType).toBe('image/jpeg')
    expect(outcome.capture?.data.equals(JPEG)).toBe(true)
  })

  it('sem captura na resposta, mede na mesma', async () => {
    const outcome = await run({ [ENDPOINT]: { body: resposta({ score: 0.95 }) } })
    expect(outcome.status).toBe('ok')
    expect(outcome.capture).toBeUndefined()
  })

  it('só aceita imagens, e de tamanho razoável', () => {
    // O que vem de fora é servido no painel: um SVG ou HTML numa data URL
    // não passa, e uma «imagem» de vários MB também não.
    const audits = (data: string) => ({ 'final-screenshot': { details: { data } } })
    expect(capturaFinal(audits('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='))).toBeNull()
    expect(capturaFinal(audits('data:text/html;base64,PGh0bWw+'))).toBeNull()
    expect(capturaFinal(audits('https://exemplo.pt/imagem.jpg'))).toBeNull()
    const enorme = Buffer.alloc(2 * 1024 * 1024).toString('base64')
    expect(capturaFinal(audits(`data:image/jpeg;base64,${enorme}`))).toBeNull()
    expect(capturaFinal(audits(`data:image/webp;base64,${JPEG.toString('base64')}`))?.mimeType).toBe('image/webp')
  })
})
