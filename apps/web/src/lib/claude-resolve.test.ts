import { afterEach, describe, expect, it } from 'vitest'
import { ETIQUETA_CLAUDE_RESOLVE, GitHubError, abrirIssue, marcaDoProblema, montarIssue } from './claude-resolve'

const PROBLEMA = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'missing_hsts',
  severity: 'medium',
  title: 'Falta o cabeçalho Strict-Transport-Security',
  detail: 'O browser pode voltar a falar HTTP com o site.',
  discriminator: null,
  evidence: { headers: { server: 'Apache' } },
  firstSeenAt: new Date('2026-10-20T09:00:00Z'),
}

const SITE = { label: 'ACPA', url: 'https://acpa.pt', hostname: 'acpa.pt', platform: 'wordpress' }

describe('montarIssue', () => {
  it('leva o site, o problema, a explicação, a evidência e o procedimento', () => {
    const issue = montarIssue(PROBLEMA, SITE, 'https://jellycare.pt/sites/x/problemas')

    expect(issue.labels).toEqual([ETIQUETA_CLAUDE_RESOLVE])
    expect(issue.title).toContain('acpa.pt')
    expect(issue.body).toContain('Cabeçalhos de segurança')
    expect(issue.body).toContain('`missing_hsts`')
    expect(issue.body).toContain('https://acpa.pt (wordpress)')
    expect(issue.body).toContain('"server": "Apache"')
    expect(issue.body).toContain('docs/procedimentos/cabecalhos.md')
    expect(issue.body).toContain('Não apliques nada em produção')
    expect(issue.body).toContain('https://jellycare.pt/sites/x/problemas')
    expect(issue.body).toContain(marcaDoProblema(PROBLEMA.id))
  })

  it('aponta para o procedimento da família certa', () => {
    expect(montarIssue({ ...PROBLEMA, code: 'dmarc_policy_none' }, SITE, 'x').body).toContain('docs/procedimentos/email.md')
    expect(montarIssue({ ...PROBLEMA, code: 'wp_core_outdated' }, SITE, 'x').body).toContain(
      'docs/procedimentos/wordpress.md',
    )
  })

  it('corta uma evidência enorme em vez de a despejar na issue', () => {
    const issue = montarIssue({ ...PROBLEMA, evidence: { texto: 'x'.repeat(10_000) } }, SITE, 'x')
    expect(issue.body.length).toBeLessThan(5000)
  })

  it('recusa um problema que o Claude Resolve não trata', () => {
    expect(() => montarIssue({ ...PROBLEMA, code: 'site_down' }, SITE, 'x')).toThrow()
  })
})

describe('abrirIssue', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  const issue = montarIssue(PROBLEMA, SITE, 'x')

  it('abre a issue no repositório, com o token no cabeçalho', async () => {
    process.env.GITHUB_RESOLVE_TOKEN = 'token-de-teste'
    process.env.GITHUB_API_URL = 'https://github.falso'
    let pedido: { url: string; init: RequestInit } | undefined
    const resultado = await abrirIssue('jelly-pt/site-acpa', issue, (async (url: string, init: RequestInit) => {
      pedido = { url, init }
      return new Response(JSON.stringify({ number: 12, html_url: 'https://github.com/jelly-pt/site-acpa/issues/12' }), {
        status: 201,
      })
    }) as typeof fetch)

    expect(resultado).toEqual({ number: 12, url: 'https://github.com/jelly-pt/site-acpa/issues/12' })
    expect(pedido?.url).toBe('https://github.falso/repos/jelly-pt/site-acpa/issues')
    expect(new Headers(pedido?.init.headers).get('authorization')).toBe('Bearer token-de-teste')
    expect(JSON.parse(String(pedido?.init.body))).toMatchObject({ labels: ['claude-resolve'] })
  })

  it('sem token, diz o nome do segredo em falta', async () => {
    delete process.env.GITHUB_RESOLVE_TOKEN
    await expect(abrirIssue('a/b', issue)).rejects.toThrow('GITHUB_RESOLVE_TOKEN')
  })

  it('um repositório que o token não vê dá uma mensagem que diz o que fazer, sem o token', async () => {
    process.env.GITHUB_RESOLVE_TOKEN = 'segredo-que-nao-pode-aparecer'
    const erro = await abrirIssue('a/b', issue, (async () => new Response('', { status: 404 })) as typeof fetch).catch(
      (e: unknown) => e,
    )
    expect(erro).toBeInstanceOf(GitHubError)
    expect((erro as Error).message).toContain('a/b')
    expect((erro as Error).message).not.toContain('segredo-que-nao-pode-aparecer')
  })
})
