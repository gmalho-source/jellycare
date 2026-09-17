import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { seed } from '@jellycare/db/seed'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Fluxo de entrada e painel, num browser real contra o servidor Next.
 *
 * Cobre as costuras que nem os testes de unidade nem o `next build` apanham:
 * o cookie de sessão chegar mesmo ao browser, o link de uso único não servir
 * duas vezes, e as verificações de segurança aparecerem bloqueadas enquanto a
 * propriedade do domínio não estiver provada.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL
const BUILD_PRESENT = existsSync(join(process.cwd(), '.next', 'BUILD_ID'))

// Sem base de dados ou sem build, o teste não tem o que exercitar. Saltar é
// honesto; falhar seria ruído em quem só quer correr os testes de unidade.
const describeE2E = DATABASE_URL && BUILD_PRESENT ? describe : describe.skip

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

describeE2E('fluxo de entrada e painel', () => {
  let child: ChildProcess
  let browser: Browser
  let baseUrl: string
  let logPath: string
  let logBuffer = ''
  let siteId: string

  const email = `e2e-${Date.now()}@jelly.pt`

  beforeAll(async () => {
    const seeded = await seed({
      databaseUrl: DATABASE_URL as string,
      email,
      organizationName: `E2E ${Date.now()}`,
      siteLabel: 'Site de teste',
      siteUrl: `https://e2e-${Date.now()}.exemplo.pt`,
    })
    siteId = seeded.siteId

    const port = await freePort()
    // `localhost` em ambos os lados: o cookie de sessão é por host, e servir em
    // 127.0.0.1 enquanto se navega para localhost fá-lo-ia desaparecer.
    baseUrl = `http://localhost:${port}`
    logPath = join(mkdtempSync(join(tmpdir(), 'jellycare-e2e-')), 'next.log')

    child = spawn('npx', ['next', 'start', '--port', String(port), '--hostname', '127.0.0.1'], {
      env: {
        ...process.env,
        DATABASE_URL: DATABASE_URL as string,
        JELLYCARE_APP_URL: baseUrl,
        // Sem chave de email, a ligação de entrada é escrita na consola — é
        // dali que este teste a lê.
        RESEND_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      logBuffer += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      logBuffer += chunk.toString()
    })

    const deadline = Date.now() + 60_000
    for (;;) {
      try {
        const response = await fetch(`${baseUrl}/login`)
        if (response.ok) break
      } catch {
        // Servidor ainda a arrancar.
      }
      if (Date.now() > deadline) throw new Error(`O servidor não arrancou:\n${logBuffer}`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    const preinstalled = '/opt/pw-browsers/chromium'
    browser = await chromium.launch({
      ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    child?.kill('SIGTERM')
  })

  function loginLink(): string {
    const fromLog = [...logBuffer.matchAll(/ligação de entrada para \S+: (\S+)/g)].pop()?.[1]
    const fromFile = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    const link = fromLog ?? [...fromFile.matchAll(/ligação de entrada para \S+: (\S+)/g)].pop()?.[1]
    if (!link) throw new Error(`Nenhuma ligação de entrada no registo:\n${logBuffer}`)
    return link
  }

  it('entra com ligação de uso único e mostra o painel', async () => {
    const page = await browser.newPage()

    await page.goto(`${baseUrl}/login`)
    await page.fill('#email', email)
    await page.click('button[type=submit]')
    await page.waitForSelector('text=Se este email tiver conta')

    await page.goto(loginLink())
    await page.waitForURL(`${baseUrl}/`)

    await expect.poll(() => page.textContent('h1')).toBe('Sites')
    expect(await page.isVisible('text=Site de teste')).toBe(true)

    await page.close()
  }, 90_000)

  it('recusa a reutilização da ligação de entrada', async () => {
    const page = await browser.newPage()

    await page.goto(`${baseUrl}/login`)
    await page.fill('#email', email)
    await page.click('button[type=submit]')
    await page.waitForSelector('text=Se este email tiver conta')

    const link = loginLink()
    const primeira = await browser.newPage()
    await primeira.goto(link)
    await primeira.waitForURL(`${baseUrl}/`)

    // Um link intercetado não pode servir de chave permanente.
    await page.goto(link)
    expect(page.url()).toContain('/login')

    await primeira.close()
    await page.close()
  }, 90_000)

  it('mostra as verificações de segurança bloqueadas até o domínio estar provado', async () => {
    const page = await browser.newPage()

    await page.goto(`${baseUrl}/login`)
    await page.fill('#email', email)
    await page.click('button[type=submit]')
    await page.waitForSelector('text=Se este email tiver conta')
    await page.goto(loginLink())
    await page.waitForURL(`${baseUrl}/`)

    await page.goto(`${baseUrl}/sites/${siteId}`)
    await page.waitForSelector('h1')

    expect(await page.isVisible('text=Falta provar a propriedade do domínio')).toBe(true)
    expect(await page.isVisible('text=jellycare-site-verification=')).toBe(true)

    // Seis dos sete checks exigem verificação; só a disponibilidade corre.
    const bloqueados = await page.locator('text=Aguarda verificação do domínio').count()
    expect(bloqueados).toBe(6)

    await page.close()
  }, 90_000)

  it('exige sessão para ver o painel', async () => {
    const anonima = await browser.newPage()
    await anonima.goto(`${baseUrl}/`)

    expect(anonima.url()).toContain('/login')
    await anonima.close()
  }, 60_000)
})
