import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { createDatabase, schema } from '@jellycare/db'
import { seed } from '@jellycare/db/seed'
import { eq } from 'drizzle-orm'
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

const INBOX_SECRET = 'segredo-de-teste-da-inbox'
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
  const emailCliente = `cliente-${Date.now()}@exemplo.pt`
  let siteDeOutroCliente: string

  beforeAll(async () => {
    const seeded = await seed({
      databaseUrl: DATABASE_URL as string,
      email,
      organizationName: `E2E ${Date.now()}`,
      siteLabel: 'Site de teste',
      siteUrl: `https://e2e-${Date.now()}.exemplo.pt`,
    })
    siteId = seeded.siteId

    // Histórico mínimo no site do teste. Sem isto, a lista de sites nunca
    // exercita as agregações de última execução e de disponibilidade — e foi
    // exatamente aí que uma agregação mal tipada deitou a página abaixo em
    // qualquer site que já tivesse corrido alguma vez.
    {
      const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
      try {
        await db.insert(schema.checkRuns).values({
          siteId,
          checkType: 'uptime',
          status: 'ok',
          region: 'eu-west',
          startedAt: new Date(Date.now() - 4 * 60_000),
          durationMs: 210,
          metrics: { up: 1, statusCode: 200, responseTimeMs: 210 },
        })
        // Uma execução com cobertura reduzida: tem de aparecer no painel
        // interno e nunca no portal do cliente.
        await db.insert(schema.checkRuns).values({
          siteId,
          checkType: 'reputation',
          status: 'ok',
          region: 'eu-west',
          startedAt: new Date(Date.now() - 3 * 60_000),
          durationMs: 340,
          warnings: ['Fonte de reputação indisponível — safe_browsing: respondeu 400'],
          metrics: { providersQueried: 2, providersSucceeded: 1, providersFailed: 1 },
        })
        await db.insert(schema.uptimeSamples).values([
          {
            siteId,
            region: 'eu-west',
            observedAt: new Date(Date.now() - 4 * 60_000),
            up: true,
            statusCode: 200,
            responseTimeMs: 210,
          },
          {
            siteId,
            region: 'eu-west',
            observedAt: new Date(Date.now() - 9 * 60_000),
            up: false,
            statusCode: 503,
            failureReason: 'HTTP 503',
          },
        ])
      } finally {
        await close()
      }
    }

    // Um utilizador com papel `client` na mesma organização, e um site de
    // outra organização a que ele não pertence. O segundo existe para provar o
    // isolamento: é a propriedade que, se falhar, mostra a um cliente os dados
    // de outro.
    {
      const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
      try {
        const [site] = await db
          .select({ organizationId: schema.sites.organizationId })
          .from(schema.sites)
          .where(eq(schema.sites.id, siteId))
          .limit(1)

        const [utilizador] = await db
          .insert(schema.users)
          .values({ email: emailCliente })
          .returning({ id: schema.users.id })

        await db.insert(schema.memberships).values({
          organizationId: site!.organizationId,
          userId: utilizador!.id,
          role: 'client',
        })

        const [outraOrg] = await db
          .insert(schema.organizations)
          .values({ name: `Outro ${Date.now()}`, slug: `outro-${Date.now()}` })
          .returning({ id: schema.organizations.id })

        const [outroSite] = await db
          .insert(schema.sites)
          .values({
            organizationId: outraOrg!.id,
            label: 'Site de outro cliente',
            url: `https://outro-${Date.now()}.exemplo.pt`,
            hostname: 'outro.exemplo.pt',
            state: 'active',
          })
          .returning({ id: schema.sites.id })
        siteDeOutroCliente = outroSite!.id
      } finally {
        await close()
      }
    }

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
        CANARY_INBOX_WEBHOOK_SECRET: INBOX_SECRET,
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

    // A linha do site mostra o histórico agregado: disponibilidade das últimas
    // 24 horas e quando correu a última verificação.
    const linha = page.locator('tr', { hasText: 'Site de teste' })
    await expect.poll(() => linha.textContent()).toContain('50,00%')
    expect(await linha.textContent()).toMatch(/minuto|hora|segundo/)

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

  async function entrarComo(correio: string) {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/login`)
    await page.fill('#email', correio)
    await page.click('button[type=submit]')
    await page.waitForSelector('text=Se este email tiver conta')
    await page.goto(loginLink())
    return page
  }

  it('leva o cliente para o portal e não para o painel interno', async () => {
    // O painel interno mostra configuração, tokens de verificação e o botão de
    // adicionar sites. Um cliente não tem nada que fazer lá.
    const page = await entrarComo(emailCliente)

    await page.waitForURL(`${baseUrl}/portal`)
    expect(await page.isVisible('text=Site de teste')).toBe(true)
    expect(await page.isVisible('text=Adicionar site')).toBe(false)

    await page.close()
  }, 90_000)

  it('não deixa o cliente ver o site de outro cliente', async () => {
    // A propriedade que, se falhar, mostra a um cliente os dados de outro.
    const page = await entrarComo(emailCliente)
    await page.waitForURL(`${baseUrl}/portal`)

    await page.goto(`${baseUrl}/portal/sites/${siteDeOutroCliente}`)

    expect(page.url()).not.toContain(siteDeOutroCliente)
    expect(await page.isVisible('text=Site de outro cliente')).toBe(false)

    await page.close()
  }, 90_000)

  it('dá acesso a um cliente a partir do painel e ele entra no portal', async () => {
    // O ciclo completo do convite: a equipa dá acesso pela interface, a pessoa
    // pede a sua própria ligação de entrada, e aterra no portal. Sem isto, dar
    // acesso a um cliente exigia mexer na base de dados.
    const convidado = `convidado-${Date.now()}@exemplo.pt`

    const painel = await entrarComo(email)
    await painel.waitForURL(`${baseUrl}/`)
    await painel.goto(`${baseUrl}/sites/${siteId}`)
    await painel.fill('#access-email', convidado)
    await painel.selectOption('#access-role', 'client')
    await painel.click('button:has-text("Dar acesso")')
    await painel.waitForSelector(`text=${convidado}`)
    await painel.close()

    const cliente = await entrarComo(convidado)
    await cliente.waitForURL(`${baseUrl}/portal`)
    expect(await cliente.isVisible('text=Site de teste')).toBe(true)
    await cliente.close()
  }, 120_000)

  it('pede o envio imediato do relatório para o email escolhido', async () => {
    // O painel não gera o PDF — não tem browser — por isso a resposta diz "a
    // preparar" e não "enviado". Prometer o que ainda não aconteceu a quem
    // está a olhar para o ecrã era mentir-lhe.
    const painel = await entrarComo(email)
    await painel.goto(`${baseUrl}/sites/${siteId}`)
    await painel.waitForSelector('#report-recipient')

    await painel.fill('#report-recipient', 'reuniao@exemplo.pt')
    await painel.click('button:has-text("Enviar agora")')

    await painel.waitForSelector('text=A preparar o relatório para reuniao@exemplo.pt')
    await painel.close()

    // O pedido ficou registado com o destinatário escolhido, à espera do worker.
    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 1 })
    try {
      const pedidos = await db
        .select()
        .from(schema.reportRequests)
        .where(eq(schema.reportRequests.siteId, siteId))
      expect(pedidos).toHaveLength(1)
      expect(pedidos[0]?.recipients).toEqual(['reuniao@exemplo.pt'])
      expect(pedidos[0]?.completedAt).toBeNull()
    } finally {
      await close()
    }
  }, 120_000)

  it('reenvia o convite a quem já tem acesso', async () => {
    // Sem isto, uma mensagem apagada ou apanhada pelo spam obrigava a retirar
    // o acesso e a voltar a dá-lo só para o email sair outra vez.
    const painel = await entrarComo(email)
    await painel.goto(`${baseUrl}/sites/${siteId}`)
    await painel.waitForSelector(`text=${emailCliente}`)

    const linha = painel.locator('li', { hasText: emailCliente })
    await linha.getByRole('button', { name: 'Reenviar convite' }).click()

    await painel.waitForSelector(`text=Aviso reenviado para ${emailCliente}`)
    // O acesso não é tocado: reenviar é só repetir a mensagem.
    expect(await painel.isVisible(`text=${emailCliente}`)).toBe(true)

    await painel.close()
  }, 120_000)

  it('mostra a cobertura reduzida à equipa e esconde-a do cliente', async () => {
    // Uma fonte de reputação mal configurada é um defeito da plataforma, não
    // um problema do site. Tem de chegar a quem a pode corrigir e não pode
    // aparecer ao cliente, que não tem nada a ver com isso nem o pode
    // resolver.
    const equipa = await entrarComo(email)
    await equipa.goto(`${baseUrl}/sites/${siteId}`)
    await equipa.waitForSelector('h1')
    expect(await equipa.isVisible('text=Cobertura reduzida')).toBe(true)
    expect(await equipa.isVisible('text=safe_browsing')).toBe(true)
    await equipa.close()

    const cliente = await entrarComo(emailCliente)
    await cliente.waitForURL(`${baseUrl}/portal`)
    await cliente.goto(`${baseUrl}/portal/sites/${siteId}`)
    await cliente.waitForSelector('h1')
    expect(await cliente.isVisible('text=Cobertura reduzida')).toBe(false)
    expect(await cliente.isVisible('text=safe_browsing')).toBe(false)
    await cliente.close()
  }, 120_000)

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

    // Só a disponibilidade corre sem prova de propriedade; tudo o resto fica à
    // espera. Conta-se o que corre e não o que está bloqueado: o número de
    // verificações cresce com o produto, o número de exceções à regra não.
    const bloqueados = await page.locator('text=Aguarda verificação do domínio').count()
    const total = await page.locator('[data-check-row]').count()
    expect(bloqueados).toBe(total - 1)

    await page.close()
  }, 90_000)

  it('fecha o circuito da notificação do formulário', async () => {
    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })

    try {
      // Uma submissão feita há dez minutos, ainda à espera do email.
      const [form] = await db
        .insert(schema.forms)
        .values({
          siteId,
          label: 'Contacto',
          pageUrl: 'https://exemplo.pt/contactos',
          selector: '#contacto',
        })
        .returning({ id: schema.forms.id })

      const token = randomUUID().replace(/-/g, '').slice(0, 16)
      const submittedAt = new Date(Date.now() - 10 * 60_000)

      await db.insert(schema.formRuns).values({
        formId: form!.id,
        siteId,
        canaryToken: token,
        canaryAddress: `check+${siteId}-${token}@check.jellycare.pt`,
        startedAt: submittedAt,
        submitted: true,
      })

      const payload = JSON.stringify({
        to: `check+${siteId}-${token}@check.jellycare.pt`,
        from: 'wordpress@cliente.pt',
        subject: 'Novo contacto do site',
        text: `Referência do teste: ${token}`,
        headers: { 'Authentication-Results': 'mx; spf=pass; dkim=pass; dmarc=pass' },
      })

      const timestamp = String(Math.floor(Date.now() / 1000))
      const signature = createHmac('sha256', INBOX_SECRET)
        .update(`${timestamp}.${payload}`)
        .digest('hex')

      const headers = {
        'content-type': 'application/json',
        'x-jellycare-timestamp': timestamp,
        'x-jellycare-signature': `sha256=${signature}`,
      }

      const response = await fetch(`${baseUrl}/api/inbound-email`, {
        method: 'POST',
        headers,
        body: payload,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ status: 'registado' })

      const [run] = await db
        .select()
        .from(schema.formRuns)
        .where(eq(schema.formRuns.canaryToken, token))

      expect(run?.emailReceived).toBe(true)
      expect(run?.spf).toBe('pass')
      expect(run?.dmarc).toBe('pass')
      // A latência é medida contra a submissão, não contra a receção do pedido.
      expect(run?.deliveryLatencyMs).toBeGreaterThan(9 * 60_000)

      // O fornecedor repete entregas quando não recebe 2xx a tempo; a segunda
      // não pode sobrepor-se à primeira.
      const repetida = await fetch(`${baseUrl}/api/inbound-email`, {
        method: 'POST',
        headers,
        body: payload,
      })
      expect(await repetida.json()).toMatchObject({ status: 'ja_registado' })
    } finally {
      await close()
    }
  }, 90_000)

  it('recusa uma entrega sem assinatura válida', async () => {
    const payload = JSON.stringify({ to: 'check+x-y@check.jellycare.pt' })
    const timestamp = String(Math.floor(Date.now() / 1000))

    const response = await fetch(`${baseUrl}/api/inbound-email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-jellycare-timestamp': timestamp,
        'x-jellycare-signature': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: payload,
    })

    // Sem isto, qualquer pessoa podia declarar que as notificações de um site
    // funcionam quando não funcionam.
    expect(response.status).toBe(401)
  }, 60_000)

  it('aceita e ignora email humano dirigido à caixa de verificação', async () => {
    const payload = JSON.stringify({
      to: 'geral@check.jellycare.pt',
      subject: 'Olá',
      text: 'Queria pedir um orçamento.',
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', INBOX_SECRET)
      .update(`${timestamp}.${payload}`)
      .digest('hex')

    const response = await fetch(`${baseUrl}/api/inbound-email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-jellycare-timestamp': timestamp,
        'x-jellycare-signature': signature,
      },
      body: payload,
    })

    // 202 e não erro: devolver erro faria o fornecedor insistir sem fim.
    expect(response.status).toBe(202)
  }, 60_000)

  it('entrega o PDF do relatório a quem pertence à organização', async () => {
    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })

    let reportId: string
    try {
      const [report] = await db
        .insert(schema.reports)
        .values({
          siteId,
          periodYear: 2026,
          periodMonth: 5,
          pdf: Buffer.from('%PDF-1.7 conteudo de teste'),
          fileName: 'jellycare-teste-2026-05.pdf',
          highlights: {
            summary: ['O site esteve sempre disponível.'],
            uptimePercent: 100,
            slaMet: true,
            incidents: 0,
            findingsResolved: 0,
            findingsOpen: 0,
          },
        })
        .returning({ id: schema.reports.id })
      reportId = report!.id
    } finally {
      await close()
    }

    const page = await browser.newPage()
    await page.goto(`${baseUrl}/login`)
    await page.fill('#email', email)
    await page.click('button[type=submit]')
    await page.waitForSelector('text=Se este email tiver conta')
    await page.goto(loginLink())
    await page.waitForURL(`${baseUrl}/`)

    await page.goto(`${baseUrl}/sites/${siteId}`)
    expect(await page.isVisible('text=Maio de 2026')).toBe(true)

    const response = await page.request.get(`${baseUrl}/api/reports/${reportId}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/pdf')
    expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-')

    // Sem sessão, o mesmo relatório não é servido.
    const anonima = await browser.newPage()
    const semSessao = await anonima.request.get(`${baseUrl}/api/reports/${reportId}`)
    expect(semSessao.status()).toBe(401)

    await anonima.close()
    await page.close()
  }, 90_000)

  it('exige sessão para ver o painel', async () => {
    const anonima = await browser.newPage()
    await anonima.goto(`${baseUrl}/`)

    expect(anonima.url()).toContain('/login')
    await anonima.close()
  }, 60_000)
})
