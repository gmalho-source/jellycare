import { runCheck, type CheckContext } from '@jellycare/core'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { brokenLinksCheck } from './broken-links.js'
import { exposedFilesCheck } from './exposed-files.js'
import { securityHeadersCheck } from './security-headers.js'
import { uptimeCheck } from './uptime.js'

/**
 * Smoke test contra um servidor HTTP real.
 *
 * Os testes unitários usam um `fetch` falso, que valida a lógica mas não o
 * comportamento do cliente HTTP perante um socket verdadeiro: corpos em
 * streaming, headers repetidos, keep-alive e ligações a fechar. Este ficheiro
 * fecha essa lacuna.
 */

const PAGES: Record<string, { status?: number; type?: string; body: string }> = {
  '/': {
    type: 'text/html',
    body: `<!doctype html><html><head><title>Cliente</title></head><body>
      <h1>Cliente</h1>
      <a href="/sobre">Sobre nós</a>
      <a href="/pagina-que-nao-existe">Link partido</a>
      <img src="/logo.png" alt="Logótipo">
      <img src="/imagem-perdida.png" alt="Perdida">
    </body></html>`,
  },
  '/sobre': {
    type: 'text/html',
    body: '<!doctype html><html><body><a href="/">Início</a></body></html>',
  },
  '/logo.png': { type: 'image/png', body: 'PNG' },
  '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /privado/\n' },
  '/.env': { type: 'text/plain', body: 'APP_KEY=segredo\nDB_PASSWORD=muito-secreta\n' },
}

let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] as string
    const page = PAGES[path]

    if (!page) {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><body><h1>404</h1></body></html>')
      return
    }

    res.writeHead(page.status ?? 200, { 'content-type': page.type ?? 'text/plain' })
    res.end(req.method === 'HEAD' ? undefined : page.body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function context(): CheckContext {
  return {
    site: {
      id: 'site-smoke',
      organizationId: 'org-smoke',
      url: baseUrl,
      hostname: '127.0.0.1',
      label: 'Servidor local',
    },
    now: new Date(),
    fetch: globalThis.fetch,
  }
}

describe('smoke: checks contra um servidor real', () => {
  it('uptime lê o site e valida o conteúdo', async () => {
    const outcome = await runCheck(uptimeCheck, context(), { expectedContent: 'Cliente' })

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.up).toBe(1)
    expect(outcome.metrics.responseTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('uptime deteta conteúdo em falta num site que responde 200', async () => {
    const outcome = await runCheck(uptimeCheck, context(), {
      expectedContent: 'Texto que não existe na página',
    })

    expect(outcome.findings[0]?.code).toBe('content_missing')
  })

  it('o crawler encontra o link partido e a imagem em falta', async () => {
    const outcome = await runCheck(brokenLinksCheck, context(), { crawlDelayMs: 0 })

    expect(outcome.status).toBe('ok')
    expect(outcome.metrics.pagesCrawled).toBe(2)

    const broken = outcome.findings.find((f) => f.code === 'link_broken')
    expect(broken?.evidence).toMatchObject({ anchorText: 'Link partido', status: 404 })

    const asset = outcome.findings.find((f) => f.code === 'asset_missing')
    expect(asset?.evidence).toMatchObject({ anchorText: 'Perdida', kind: 'image' })

    // O logótipo e a página "sobre" existem: não podem aparecer no relatório.
    expect(outcome.findings.map((f) => f.discriminator)).not.toContain(`${baseUrl}/logo.png`)
  })

  it('os ficheiros expostos são detetados com a linha de base correta', async () => {
    const outcome = await runCheck(exposedFilesCheck, context(), {})

    // O servidor devolve 404 real, por isso não há soft-404 a confundir.
    expect(outcome.metrics.softNotFound).toBe(0)
    expect(outcome.findings.map((f) => f.code)).toEqual(['exposed_env'])
  })

  it('os headers em falta são reportados num servidor sem configuração', async () => {
    const outcome = await runCheck(securityHeadersCheck, context(), {})

    const found = outcome.findings.map((f) => f.code)
    expect(found).toContain('missing_content_type_options')
    expect(found).toContain('missing_frame_protection')
    // O site é HTTP: exigir HSTS ou redirect para HTTPS aqui seria incorreto.
    expect(found).not.toContain('missing_hsts')
    expect(found).not.toContain('http_not_redirected')
  })
})
