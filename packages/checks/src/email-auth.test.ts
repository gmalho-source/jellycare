import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import { analyzeDmarc, analyzeSpf, emailAuthCheck, type TxtResolver } from './email-auth.js'
import { testSite } from './test-utils.js'

/** Resolver falso: mapa de hostname para registos TXT já divididos em chunks. */
function resolver(records: Record<string, string[][]>): TxtResolver {
  return async (hostname: string) => {
    const found = records[hostname]
    if (!found) {
      const error = new Error('queryTxt ENOTFOUND') as Error & { code: string }
      error.code = 'ENOTFOUND'
      throw error
    }
    return found
  }
}

async function run(records: Record<string, string[][]>, dkimSelectors = ['default']) {
  const context: CheckContext = { site: testSite, now: new Date(), fetch: globalThis.fetch }
  return runCheck(emailAuthCheck, context, { resolver: resolver(records), dkimSelectors })
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code).sort()
}

const HEALTHY = {
  'cliente.pt': [['v=spf1 include:_spf.google.com -all']],
  '_dmarc.cliente.pt': [['v=DMARC1; p=reject; rua=mailto:dmarc@cliente.pt']],
  'default._domainkey.cliente.pt': [['v=DKIM1; k=rsa; p=MIGfMA0...']],
}

describe('analyzeSpf', () => {
  it('lê o qualificador de all', () => {
    expect(analyzeSpf([['v=spf1 -all']])).toMatchObject({ found: true, qualifier: '-', allowsAll: false })
    expect(analyzeSpf([['v=spf1 ~all']])).toMatchObject({ qualifier: '~', allowsAll: false })
    expect(analyzeSpf([['v=spf1 +all']])).toMatchObject({ qualifier: '+', allowsAll: true })
  })

  it('trata "all" sem qualificador como +all, que é o que a norma manda', () => {
    expect(analyzeSpf([['v=spf1 mx all']])).toMatchObject({ qualifier: '+', allowsAll: true })
  })

  it('junta registos TXT partidos em chunks de 255 caracteres', () => {
    // O DNS parte strings longas; tratá-las separadamente perderia o "-all".
    const analysis = analyzeSpf([['v=spf1 include:um.pt include:dois.pt ', '-all']])
    expect(analysis.record).toBe('v=spf1 include:um.pt include:dois.pt -all')
    expect(analysis.allowsAll).toBe(false)
  })

  it('deteta registos SPF duplicados', () => {
    const analysis = analyzeSpf([['v=spf1 -all'], ['v=spf1 include:outro.pt ~all']])
    expect(analysis.duplicated).toBe(true)
  })

  it('ignora TXT que não são SPF', () => {
    expect(analyzeSpf([['google-site-verification=abc']])).toMatchObject({ found: false })
  })
})

describe('analyzeDmarc', () => {
  it('lê a política e a percentagem', () => {
    const analysis = analyzeDmarc([['v=DMARC1; p=quarantine; pct=50']])
    expect(analysis).toMatchObject({ found: true, policy: 'quarantine', percentage: 50 })
  })

  it('tolera espaços à volta do igual', () => {
    expect(analyzeDmarc([['v=DMARC1; p = reject']])).toMatchObject({ policy: 'reject' })
  })

  it('ignora TXT que não são DMARC', () => {
    expect(analyzeDmarc([['v=spf1 -all']])).toMatchObject({ found: false })
  })
})

describe('emailAuthCheck', () => {
  it('não reporta nada num domínio bem configurado', async () => {
    const outcome = await run(HEALTHY)
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics).toMatchObject({ spfPresent: 1, dmarcPresent: 1, dkimSelectorsFound: 1 })
  })

  it('reporta a ausência de SPF e DMARC', async () => {
    const outcome = await run({})
    expect(codes(outcome.findings)).toEqual(['dkim_not_found', 'dmarc_missing', 'spf_missing'])
  })

  it('trata +all como problema grave', async () => {
    const outcome = await run({ ...HEALTHY, 'cliente.pt': [['v=spf1 +all']] })
    const finding = outcome.findings.find((f) => f.code === 'spf_permissive')
    expect(finding?.severity).toBe('high')
  })

  it('trata SPF duplicado como grave, porque invalida a política toda', async () => {
    const outcome = await run({
      ...HEALTHY,
      'cliente.pt': [['v=spf1 include:um.pt -all'], ['v=spf1 include:dois.pt -all']],
    })
    const finding = outcome.findings.find((f) => f.code === 'spf_duplicated')
    expect(finding?.severity).toBe('high')
  })

  it('assinala p=none como passo intermédio, não como falha', async () => {
    const outcome = await run({
      ...HEALTHY,
      '_dmarc.cliente.pt': [['v=DMARC1; p=none']],
    })
    const finding = outcome.findings.find((f) => f.code === 'dmarc_policy_none')
    expect(finding?.severity).toBe('low')
  })

  it('usa o domínio registável, não o hostname do site', async () => {
    const context: CheckContext = {
      site: { ...testSite, hostname: 'www.cliente.pt', url: 'https://www.cliente.pt' },
      now: new Date(),
      fetch: globalThis.fetch,
    }
    const outcome = await runCheck(emailAuthCheck, context, {
      resolver: resolver(HEALTHY),
      dkimSelectors: ['default'],
    })

    // Consulta cliente.pt e não www.cliente.pt: o email sai do domínio, não do
    // subdomínio onde o site está alojado.
    expect(outcome.findings).toEqual([])
  })

  it('deixa claro que a ausência de DKIM não é conclusiva', async () => {
    const outcome = await run({ ...HEALTHY, 'default._domainkey.cliente.pt': undefined as never })
    const finding = outcome.findings.find((f) => f.code === 'dkim_not_found')
    expect(finding?.severity).toBe('low')
    expect(finding?.detail).toContain('não prova a ausência')
  })
})
