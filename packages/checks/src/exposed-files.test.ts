import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import { exposedFilesCheck, type ExposedFilesConfig } from './exposed-files.js'
import { mockFetch, testSite, type MockResponse, type MockRoutes } from './test-utils.js'

const ENV_CONTENT = `APP_ENV=production
APP_KEY=base64:ZmFrZQ==
DB_HOST=127.0.0.1
DB_PASSWORD=supersecreta
`

const HOMEPAGE = '<html><body><h1>Cliente</h1><p>Bem-vindo ao nosso site.</p></body></html>'

async function run(
  routes: MockRoutes,
  options: { fallback?: MockResponse; config?: ExposedFilesConfig } = {},
) {
  const context: CheckContext = {
    site: testSite,
    now: new Date(),
    fetch: mockFetch(routes, options.fallback),
  }
  return runCheck(exposedFilesCheck, context, options.config ?? {})
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code).sort()
}

describe('exposedFilesCheck', () => {
  it('não reporta nada num site que devolve 404 a tudo', async () => {
    const outcome = await run({})
    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.softNotFound).toBe(0)
  })

  it('deteta um .env exposto', async () => {
    const outcome = await run({ 'https://cliente.pt/.env': { body: ENV_CONTENT } })

    expect(codes(outcome.findings)).toEqual(['exposed_env'])
    expect(outcome.findings[0]?.severity).toBe('critical')
    expect(outcome.findings[0]?.discriminator).toBe('/.env')
  })

  it('deteta um repositório Git exposto', async () => {
    const outcome = await run({ 'https://cliente.pt/.git/HEAD': { body: 'ref: refs/heads/main\n' } })
    expect(codes(outcome.findings)).toEqual(['exposed_git'])
  })

  it('aceita um HEAD em estado detached', async () => {
    const outcome = await run({
      'https://cliente.pt/.git/HEAD': { body: 'a'.repeat(0) + '0'.repeat(40) },
    })
    expect(codes(outcome.findings)).toEqual(['exposed_git'])
  })

  it('ignora um site com soft-404 que devolve a homepage a tudo', async () => {
    // O cenário que desacredita um scanner: sem linha de base, este site
    // reportaria todos os caminhos sensíveis como expostos.
    const outcome = await run({}, { fallback: { status: 200, body: HOMEPAGE } })

    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.softNotFound).toBe(1)
  })

  it('deteta exposição real mesmo num site com soft-404', async () => {
    const outcome = await run(
      { 'https://cliente.pt/.env': { status: 200, body: ENV_CONTENT } },
      { fallback: { status: 200, body: HOMEPAGE } },
    )

    expect(codes(outcome.findings)).toEqual(['exposed_env'])
  })

  it('não confunde uma página de erro personalizada com um .env', async () => {
    const outcome = await run({
      'https://cliente.pt/.env': {
        status: 200,
        body: '<html><body><h1>404</h1><p>DB_HOST não encontrado</p></body></html>',
      },
    })

    // Tem uma palavra-chave do .env mas é claramente HTML.
    expect(outcome.findings).toEqual([])
  })

  it('não reporta um ficheiro acessível cujo conteúdo não corresponde', async () => {
    const outcome = await run({
      'https://cliente.pt/phpinfo.php': { status: 200, body: 'Página em construção' },
    })
    expect(outcome.findings).toEqual([])
  })

  it('deteta enumeração de utilizadores do WordPress', async () => {
    const outcome = await run({
      'https://cliente.pt/wp-json/wp/v2/users': {
        body: JSON.stringify([{ id: 1, name: 'Admin', slug: 'admin' }]),
      },
    })

    expect(codes(outcome.findings)).toEqual(['wp_user_enumeration'])
  })

  it('não reporta enumeração quando a API devolve lista vazia', async () => {
    const outcome = await run({
      'https://cliente.pt/wp-json/wp/v2/users': { body: '[]' },
    })
    expect(outcome.findings).toEqual([])
  })

  it('respeita os caminhos marcados como intencionais', async () => {
    const outcome = await run(
      { 'https://cliente.pt/xmlrpc.php': { body: 'XML-RPC server accepts POST requests only.' } },
      { config: { ignorePaths: ['/xmlrpc.php'] } },
    )

    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.pathsProbed).toBe(9)
  })

  it('continua a verificar os restantes caminhos quando um falha', async () => {
    const outcome = await run({
      'https://cliente.pt/.env': { error: new Error('socket hang up') },
      'https://cliente.pt/.git/HEAD': { body: 'ref: refs/heads/main' },
    })

    expect(outcome.status).toBe('ok')
    expect(codes(outcome.findings)).toEqual(['exposed_git'])
  })

  it('não trata uma redireção para a homepage como exposição', async () => {
    const outcome = await run({
      'https://cliente.pt/.env': { status: 302, headers: { location: 'https://cliente.pt/' } },
      'https://cliente.pt/': { status: 200, body: HOMEPAGE },
    })

    // O ficheiro não existe; o servidor redireciona. O corpo final é a
    // homepage, que não passa no matcher do .env.
    expect(outcome.findings).toEqual([])
  })
})
