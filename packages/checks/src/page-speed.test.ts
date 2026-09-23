import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import {
  measurePageSpeed,
  pageSpeedCheck,
  pageSpeedDesktopCheck,
  type PageSpeedConfig,
} from './page-speed.js'
import { mockFetch, testSite, type MockRoutes } from './test-utils.js'

const ENDPOINT =
  'https://www.googleapis.com/pagespeedonline/v5/runPagespeed' +
  '?url=https%3A%2F%2Fcliente.pt&key=chave-teste&strategy=mobile&category=performance'

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
  })

  it('desiste ao fim do tempo em vez de ficar pendurado', async () => {
    const fetch = mockFetch({ [ENDPOINT]: { delayMs: 500, body: resposta({ score: 0.9 }) } })

    await expect(
      measurePageSpeed('https://cliente.pt', 'chave-teste', 'mobile', fetch, 20),
    ).rejects.toThrow()
  })
})
