import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { createDatabase, schema } from '@jellycare/db'
import { seed } from '@jellycare/db/seed'
import { and, eq } from 'drizzle-orm'
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
  let siteVerificado: string

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
          checkType: 'form_test',
          status: 'ok',
          region: 'eu-west',
          startedAt: new Date(Date.now() - 3 * 60_000),
          durationMs: 340,
          warnings: ['Páginas declaradas que o rastreio não chegou a pedir: /contactos.'],
          metrics: { submitted: 1, delivered: 1 },
        })
        // Duas medições de velocidade, para o painel ter uma pontuação atual
        // e uma tendência. Uma só não prova nada: a tendência não aparece, e
        // um erro na diferença entre a primeira e a última passava.
        await db.insert(schema.checkRuns).values([
          {
            siteId,
            checkType: 'page_speed',
            status: 'ok',
            region: 'eu-west',
            startedAt: new Date(Date.now() - 8 * 24 * 3600_000),
            durationMs: 21_000,
            metrics: { performanceScore: 51, lcpMs: 4100, cls: 0.19, tbtMs: 410 },
          },
          {
            siteId,
            checkType: 'page_speed',
            status: 'ok',
            region: 'eu-west',
            startedAt: new Date(Date.now() - 2 * 3600_000),
            durationMs: 19_400,
            metrics: { performanceScore: 63, lcpMs: 3200, cls: 0.06, tbtMs: 150 },
          },
        ])
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

        // Um segundo site na organização do cliente, este já com a
        // propriedade provada: é a condição para o painel de métricas
        // aparecer, no interno e no portal.
        const [verificado] = await db
          .insert(schema.sites)
          .values({
            organizationId: site!.organizationId,
            label: 'Site verificado',
            url: `https://verificado-${Date.now()}.exemplo.pt`,
            hostname: `verificado-${Date.now()}.exemplo.pt`,
            state: 'active',
          })
          .returning({ id: schema.sites.id })
        siteVerificado = verificado!.id

        await db.insert(schema.siteVerifications).values({
          siteId: siteVerificado,
          method: 'dns_txt',
          token: `token-${Date.now()}`,
          state: 'verified',
          verifiedAt: new Date(),
        })

        // Uma verificação falhada e uma amostra em baixo: a falha é nossa e
        // só a equipa a vê; a indisponibilidade é do site e o cliente vê-a.
        await db.insert(schema.checkRuns).values([
          {
            siteId: siteVerificado,
            checkType: 'uptime',
            status: 'ok',
            region: 'eu-west',
            startedAt: new Date(Date.now() - 5 * 60_000),
            durationMs: 180,
            metrics: { up: 1, statusCode: 200, responseTimeMs: 180 },
          },
          {
            siteId: siteVerificado,
            checkType: 'security_headers',
            status: 'failed',
            region: 'eu-west',
            startedAt: new Date(Date.now() - 6 * 60_000),
            durationMs: 90,
            error: 'ligação recusada',
            metrics: {},
          },
        ])
        await db.insert(schema.uptimeSamples).values([
          {
            siteId: siteVerificado,
            region: 'eu-west',
            observedAt: new Date(Date.now() - 5 * 60_000),
            up: true,
            statusCode: 200,
            responseTimeMs: 180,
          },
          {
            siteId: siteVerificado,
            region: 'eu-west',
            observedAt: new Date(Date.now() - 50 * 60_000),
            up: false,
            statusCode: 503,
            failureReason: 'HTTP 503',
          },
        ])

        // Uma medição de velocidade no site que o cliente vê. Números
        // diferentes dos do site da equipa de propósito: se a página do
        // portal fosse buscar os dados ao site errado, o teste passava na
        // mesma com valores iguais.
        await db.insert(schema.checkRuns).values({
          siteId: siteVerificado,
          checkType: 'page_speed',
          status: 'ok',
          region: 'eu-west',
          startedAt: new Date(Date.now() - 3 * 3600_000),
          durationMs: 18_200,
          metrics: { performanceScore: 42, lcpMs: 5400, cls: 0.21, tbtMs: 480 },
        })

        // Um site WordPress ligado, com o core atrasado e um plugin por
        // atualizar. O core e os plugins são contas separadas no painel, e é
        // exatamente isso que este retrato serve para provar.
        await db.insert(schema.connectors).values({
          siteId: siteVerificado,
          type: 'wp_umbrella',
          externalId: '123',
          externalName: 'Site verificado',
          lastSyncAt: new Date(Date.now() - 2 * 3600_000),
        })
        await db.insert(schema.wpComponents).values([
          {
            siteId: siteVerificado,
            kind: 'core',
            key: 'wordpress',
            name: 'WordPress',
            version: '6.4.3',
            latestVersion: '6.7.1',
            active: true,
          },
          {
            siteId: siteVerificado,
            kind: 'plugin',
            key: 'contact-form-7/wp-contact-form-7.php',
            name: 'contact-form-7',
            version: '5.7.0',
            latestVersion: '5.9.0',
            active: true,
          },
        ])
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
    //
    // Restrito ao conteúdo: o mesmo nome aparece também na coluna de
    // navegação, e sem isto o localizador apanhava as duas entradas.
    const linha = page.locator('main li', { hasText: 'Site de teste' })
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
    await painel.goto(`${baseUrl}/sites/${siteId}/definicoes`)
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
    await painel.goto(`${baseUrl}/sites/${siteId}/relatorios`)
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
    await painel.goto(`${baseUrl}/sites/${siteId}/definicoes`)
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
    await equipa.goto(`${baseUrl}/sites/${siteId}/seguranca`)
    await equipa.waitForSelector('h1')
    expect(await equipa.isVisible('text=Cobertura reduzida')).toBe(true)
    expect(await equipa.isVisible('text=/contactos')).toBe(true)
    await equipa.close()

    const cliente = await entrarComo(emailCliente)
    await cliente.waitForURL(`${baseUrl}/portal`)
    await cliente.goto(`${baseUrl}/portal/sites/${siteId}`)
    await cliente.waitForSelector('h1')
    expect(await cliente.isVisible('text=Cobertura reduzida')).toBe(false)
    expect(await cliente.isVisible('text=/contactos')).toBe(false)
    await cliente.close()
  }, 120_000)

  it('não consegue dizer que está tudo bem com a monitorização parada', async () => {
    // O painel manteve-se verde durante dezoito horas a mostrar os números da
    // véspera. Um painel que consegue esconder que está parado é pior do que
    // não ter painel: dá confiança a quem não devia tê-la.
    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
    try {
      const parado = {
        lastTickAt: new Date(Date.now() - 6 * 3600_000),
        lastHealthyTickAt: new Date(Date.now() - 6 * 3600_000),
        lastError: 'ERR max requests limit exceeded. Limit: 500000, Usage: 500011',
        lastErrorAt: new Date(Date.now() - 6 * 3600_000),
        considered: 0,
        enqueued: 0,
        failed: 0,
      }
      await db
        .insert(schema.schedulerHeartbeats)
        .values({ id: 'checks', ...parado })
        .onConflictDoUpdate({ target: schema.schedulerHeartbeats.id, set: parado })
    } finally {
      await close()
    }

    const equipa = await entrarComo(email)
    await equipa.waitForSelector('h1')

    expect(await equipa.isVisible('text=A monitorização está parada há 6 horas')).toBe(true)
    // A mensagem exata do fornecedor, no painel. Da última vez existia só nos
    // registos, catorze mil vezes por minuto, e quem podia agir não a via.
    expect(await equipa.isVisible('text=max requests limit exceeded')).toBe(true)
    // E a frase tranquilizadora desaparece.
    expect(await equipa.isVisible('text=nenhum com problemas abertos')).toBe(false)
    await equipa.close()

    // O vigia externo vê o mesmo, sem sessão nenhuma.
    const resposta = await fetch(`${baseUrl}/api/health/scheduler`)
    expect(resposta.status).toBe(503)
    expect((await resposta.json()).status).toBe('stale')
  }, 120_000)

  it('avisa quando o agendador está vivo mas um check deixou de concluir', async () => {
    // A classe de falha a seguir à que nos apanhou: o ciclo enfileira, os jobs
    // falham todos, e o primeiro sinal de vida dá a plataforma por saudável.
    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
    try {
      const vivo = {
        lastTickAt: new Date(),
        lastHealthyTickAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        considered: 12,
        enqueued: 3,
        failed: 0,
      }
      await db
        .insert(schema.schedulerHeartbeats)
        .values({ id: 'checks', ...vivo })
        .onConflictDoUpdate({ target: schema.schedulerHeartbeats.id, set: vivo })

      // O uptime deste site teve sucesso há muito tempo e nada desde então.
      // A tolerância de um check de 5 minutos é 20; seis horas é atraso a sério.
      await db
        .update(schema.checkRuns)
        .set({ startedAt: new Date(Date.now() - 6 * 3600_000) })
        .where(
          and(eq(schema.checkRuns.siteId, siteId), eq(schema.checkRuns.checkType, 'uptime')),
        )
    } finally {
      await close()
    }

    const equipa = await entrarComo(email)
    await equipa.waitForSelector('h1')

    // «de concluir» e não «deixou de concluir»: com mais do que um tipo
    // atrasado o título passa ao plural, «deixaram», e a asserção mais
    // específica passava a depender do número de avarias simultâneas.
    expect(await equipa.isVisible('text=de concluir')).toBe(true)
    expect(await equipa.isVisible('text=uptime')).toBe(true)
    expect(await equipa.isVisible('text=A monitorização está parada')).toBe(false)
    expect(await equipa.isVisible('text=nenhum com problemas abertos')).toBe(false)
    await equipa.close()

    // O endpoint olha para a plataforma inteira, que é o que o vigia externo
    // quer saber. Na base de testes, partilhada e acumulada, há sempre sites
    // de execuções antigas por aí — por isso a asserção é sobre o que este
    // teste controla e não sobre o total.
    const resposta = await fetch(`${baseUrl}/api/health/scheduler`)
    expect(resposta.status).toBe(503)
    const corpo = await resposta.json()
    expect(corpo.status).toBe('checks_late')
    expect(
      corpo.checks.find((c: { checkType: string }) => c.checkType === 'uptime').late,
    ).toBeGreaterThan(0)
  }, 120_000)

  it('volta a dar o painel por bom quando o agendador está vivo', async () => {
    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
    try {
      const vivo = {
        lastTickAt: new Date(),
        lastHealthyTickAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        considered: 12,
        enqueued: 3,
        failed: 0,
      }
      await db
        .insert(schema.schedulerHeartbeats)
        .values({ id: 'checks', ...vivo })
        .onConflictDoUpdate({ target: schema.schedulerHeartbeats.id, set: vivo })

      // O teste anterior empurrou estes runs seis horas para trás. Repô-los é
      // parte do que este teste mede: o aviso tem de se calar quando a avaria
      // passa, e não só aparecer quando ela chega.
      await db
        .update(schema.checkRuns)
        .set({ startedAt: new Date() })
        .where(eq(schema.checkRuns.siteId, siteId))
    } finally {
      await close()
    }

    const equipa = await entrarComo(email)
    await equipa.waitForSelector('h1')

    // Um aviso que não se cala depois de a avaria passar é um aviso que se
    // aprende a ignorar. A faixa é por organização, por isso esta asserção
    // mede mesmo os sites deste utilizador e não o ruído da base partilhada.
    expect(await equipa.isVisible('text=A monitorização está parada')).toBe(false)
    expect(await equipa.isVisible('text=de concluir')).toBe(false)
    await equipa.close()

    // O endpoint é global e a base de testes acumula sites de execuções
    // antigas, por isso o total de atrasados nunca volta a zero aqui. O que
    // este teste controla — e verifica — é o agendador: sem erro guardado e
    // fora dos estados de paragem.
    const resposta = await fetch(`${baseUrl}/api/health/scheduler`)
    const corpo = await resposta.json()
    expect(corpo.lastError).toBeNull()
    expect(['ok', 'checks_late']).toContain(corpo.status)

    // Nada disto pode ser guardado. Um sinal de vida servido de uma cache
    // responde «está tudo bem» sobre um instante que já passou, que é o
    // contrário do que um vigia externo vem cá fazer.
    expect(resposta.headers.get('cache-control')).toContain('no-store')
  }, 120_000)

  it('mostra a velocidade das páginas com a pontuação e os vitals', async () => {
    const equipa = await entrarComo(email)
    await equipa.goto(`${baseUrl}/sites/${siteId}/desempenho`)
    await equipa.waitForSelector('h1')

    // A pontuação da última medição, em 0–100. Pelo rótulo do mostrador e não
    // por «63» em texto: «63» aparece dentro de qualquer número maior, e um
    // teste que passa com «163» na página não está a provar nada.
    expect(await equipa.isVisible('[aria-label="63 em 100"]')).toBe(true)

    // A tendência face à primeira medição do período: 63 menos 51.
    expect(await equipa.isVisible('text=+12 pontos')).toBe(true)

    // Os três vitals, com os valores convertidos para as unidades que se lêem
    // e com vírgula decimal: um painel em português onde se lê «3.2 s» está a
    // usar a pontuação de outra língua no número que o cliente cita.
    expect(await equipa.isVisible('text=3,2 s')).toBe(true)
    expect(await equipa.isVisible('text=0,06')).toBe(true)
    expect(await equipa.isVisible('text=150 ms')).toBe(true)

    // A cor não anda sozinha: o estado em palavras ao lado de cada métrica.
    expect(await equipa.isVisible('text=a melhorar')).toBe(true)

    // O tempo de resposta do servidor é outra coisa e fica na mesma secção.
    expect(await equipa.isVisible('text=Tempo de resposta do servidor')).toBe(true)
    await equipa.close()
  }, 120_000)

  it('conta o core do WordPress à parte das atualizações de plugins', async () => {
    const equipa = await entrarComo(email)
    await equipa.goto(`${baseUrl}/sites/${siteVerificado}/wordpress`)
    await equipa.waitForSelector('h1')

    expect(await equipa.isVisible('text=6.4.3')).toBe(true)
    expect(await equipa.isVisible('text=Desatualizado — a atual é a 6.7.1')).toBe(true)

    // Uma atualização pendente e não duas. O core tem lugar e finding
    // próprios, e somá-lo ao agregado fazia «2 atualizações por aplicar»
    // querer dizer coisas diferentes consoante uma delas fosse o WordPress.
    const pendentes = equipa.locator('div:has-text("Atualizações pendentes")').last()
    expect((await pendentes.innerText()).replace(/\s+/g, ' ')).toBe(
      'Atualizações pendentes 1 em 1 plugins e 0 temas',
    )

    // No inventário completo o core aparece — é o inventário — mas marcado
    // como core, e não como se fosse mais um plugin chamado «WordPress».
    // O «core» cola-se ao nome no innerText porque a separação é uma margem
    // e não um espaço; no ecrã lê-se «WordPress core».
    const inventario = equipa.locator('li:has-text("WordPress")').last()
    expect((await inventario.innerText()).replace(/\s+/g, ' ')).toBe(
      'WordPresscore 6.4.3 → 6.7.1',
    )
    await equipa.close()
  }, 120_000)

  it('dá ao cliente o mesmo painel de métricas, sem o que é falha nossa', async () => {
    // O painel a 30 dias é o que justifica a avença: o cliente tem de o ver.
    // O que não pode ver é a contabilidade das nossas próprias falhas — uma
    // verificação que rebentou do nosso lado não é informação sobre o site
    // dele, é sobre nós, e é a mesma regra que já esconde a cobertura
    // reduzida do portal.
    const equipa = await entrarComo(email)
    await equipa.goto(`${baseUrl}/sites/${siteVerificado}`)
    await equipa.waitForSelector('h1')
    expect(await equipa.isVisible('text=Disponibilidade dia a dia')).toBe(true)
    expect(await equipa.isVisible('text=Verificações falhadas')).toBe(true)
    await equipa.close()

    const cliente = await entrarComo(emailCliente)
    await cliente.waitForURL(`${baseUrl}/portal`)
    await cliente.goto(`${baseUrl}/portal/sites/${siteVerificado}`)
    await cliente.waitForSelector('h1')

    // O que é dele, vê.
    expect(await cliente.isVisible('text=Disponibilidade dia a dia')).toBe(true)
    expect(await cliente.isVisible('text=Disponibilidade, 30 dias')).toBe(true)
    expect(await cliente.isVisible('text=Interrupções')).toBe(true)
    expect(await cliente.isVisible('text=O que foi feito')).toBe(true)
    expect(await cliente.isVisible('text=Verificações corridas')).toBe(true)

    // O que é nosso, não.
    expect(await cliente.isVisible('text=Verificações falhadas')).toBe(false)
    await cliente.close()
  }, 120_000)

  it('dá ao cliente a velocidade do site dele, e a navegação para lá chegar', async () => {
    // Estava só do lado interno. A pontuação e os vitals são factos sobre o
    // site de quem paga, não sobre a nossa operação — e é a secção que ele
    // leva a uma reunião.
    const cliente = await entrarComo(emailCliente)
    await cliente.waitForURL(`${baseUrl}/portal`)
    await cliente.goto(`${baseUrl}/portal/sites/${siteVerificado}`)
    await cliente.waitForSelector('h1')

    // A navegação existe no portal e leva ao desempenho. Sem isto, a página
    // podia existir e não haver caminho nenhum até ela.
    await cliente.click('nav a[href$="/desempenho"]')
    await cliente.waitForURL(`${baseUrl}/portal/sites/${siteVerificado}/desempenho`)

    // Os números deste site e não os do site da equipa.
    expect(await cliente.isVisible('[aria-label="42 em 100"]')).toBe(true)
    expect(await cliente.isVisible('text=5,4 s')).toBe(true)
    expect(await cliente.isVisible('text=Tempo de resposta do servidor')).toBe(true)

    // Continua sem ver o que é falha nossa, aqui como na visão geral.
    expect(await cliente.isVisible('text=Verificações falhadas')).toBe(false)
    await cliente.close()
  }, 120_000)

  it('trava o portal até o cliente aceitar o acordo, e guarda a prova', async () => {
    // O acordo do artigo 28.º é entre o cliente, que é o responsável pelo
    // tratamento, e a Jelly, que é a subcontratante. Quem aceita é o cliente:
    // um acordo que nós aceitássemos em nome dele não provava nada.
    //
    // Organização e utilizador próprios deste teste. `legal_documents` é
    // global — publicar um DPA passa a exigi-lo a toda a gente, que é
    // precisamente o comportamento pretendido — e por isso o que este teste
    // publica tem de sair no fim, senão contamina os outros ficheiros que
    // correm contra a mesma base de dados.
    const marca = Date.now()
    const emailDpa = `dpa-${marca}@exemplo.pt`
    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
    let documentoId = ''
    let organizationId = ''
    try {
      const [org] = await db
        .insert(schema.organizations)
        .values({ name: `DPA ${marca}`, slug: `dpa-${marca}` })
        .returning({ id: schema.organizations.id })
      organizationId = org!.id

      const [utilizador] = await db
        .insert(schema.users)
        .values({ email: emailDpa })
        .returning({ id: schema.users.id })
      await db.insert(schema.memberships).values({
        organizationId,
        userId: utilizador!.id,
        role: 'client',
      })

      // A equipa também pertence a esta organização: o estado legal aparece
      // no painel do site, e é preciso um site para o painel existir.
      const [daEquipa] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1)
      await db.insert(schema.memberships).values({
        organizationId,
        userId: daEquipa!.id,
        role: 'owner',
      })
      const [siteDpa] = await db
        .insert(schema.sites)
        .values({
          organizationId,
          label: `Site DPA ${marca}`,
          url: `https://dpa-${marca}.exemplo.pt`,
          hostname: `dpa-${marca}.exemplo.pt`,
          state: 'active',
        })
        .returning({ id: schema.sites.id })
      const siteDpaId = siteDpa!.id

      // A publicação é normalmente feita pela sincronização do worker; aqui
      // insere-se diretamente, que é o que ela faz.
      const [documento] = await db
        .insert(schema.legalDocuments)
        .values({
          kind: 'dpa',
          locale: 'pt',
          version: 800_000 + Math.floor(Math.random() * 90_000),
          title: `Acordo de teste ${marca}`,
          body: `# Acordo de teste\n\nCláusula única ${marca} para efeitos de teste.`,
          contentHash: 'a'.repeat(64),
        })
        .returning({ id: schema.legalDocuments.id })
      documentoId = documento!.id

      // Público: o jurídico do cliente tem de poder ler antes de haver conta.
      const anonimo = await browser.newPage()
      await anonimo.goto(`${baseUrl}/legal/dpa`)
      expect(await anonimo.isVisible(`text=Cláusula única ${marca}`)).toBe(true)
      await anonimo.close()

      // A equipa vê o estado no painel do site, que é onde vai antes de pôr
      // o cliente a correr.
      const painel = await entrarComo(email)
      await painel.goto(`${baseUrl}/sites/${siteDpaId}/definicoes`)
      await painel.waitForSelector('text=Tratamento de dados')
      expect(await painel.isVisible('text=O cliente ainda não aceitou o acordo')).toBe(true)

      // E pode registar que o cliente impôs o contrato dele, o que desliga o
      // pedido de aceitação. Era a metade que faltava: a coluna existia sem
      // nada que a escrevesse.
      await painel.fill('input[name=ref]', 'DPA em papel, assinado a 12/03')
      await painel.click('form:has(input[name=ref]) button[type=submit]')
      await painel.waitForSelector('text=Referência guardada')

      const semTrava = await entrarComo(emailDpa)
      await semTrava.waitForURL(`${baseUrl}/portal`)
      await semTrava.close()

      // Retirada a referência pela mesma via, volta a travar.
      await painel.fill('input[name=ref]', '')
      await painel.click('form:has(input[name=ref]) button[type=submit]')
      await painel.waitForSelector('text=Referência removida')
      await painel.close()

      // Com documento publicado e por aceitar, a entrada no portal abre no
      // acordo — inclusive vinda do link de entrada, que aponta para `/portal`.
      const cliente = await entrarComo(emailDpa)
      await cliente.waitForURL(`${baseUrl}/legal/aceitar`)
      expect(await cliente.isVisible(`text=Cláusula única ${marca}`)).toBe(true)

      await cliente.fill('input[name=representedBy]', 'Diretor de Marketing')
      await cliente.check('input[name=confirma]')
      await cliente.click('button[type=submit]')
      // Aceite, o formulário deixa de existir — não há nada por aceitar — e
      // o registo aparece no lugar dele, com o cargo declarado.
      await cliente.waitForSelector('text=Diretor de Marketing')
      expect(await cliente.isVisible('input[name=representedBy]')).toBe(false)

      // Aceite, o portal abre.
      await cliente.goto(`${baseUrl}/portal`)
      await cliente.waitForURL(`${baseUrl}/portal`)

      // E o comprovativo diz quem aceitou, com que cargo e quando.
      await cliente.goto(`${baseUrl}/legal/comprovativo`)
      expect(await cliente.isVisible('text=Diretor de Marketing')).toBe(true)
      expect(await cliente.isVisible(`text=Cláusula única ${marca}`)).toBe(true)
      await cliente.close()

      const depois = await entrarComo(email)
      await depois.goto(`${baseUrl}/sites/${siteDpaId}/definicoes`)
      await depois.waitForSelector('text=Acordo aceite')
      expect(await depois.isVisible('text=Diretor de Marketing')).toBe(true)
      await depois.close()

      const linhas = await db
        .select({
          representedBy: schema.legalAcceptances.representedBy,
          documentId: schema.legalAcceptances.documentId,
        })
        .from(schema.legalAcceptances)
        .where(eq(schema.legalAcceptances.organizationId, organizationId))
      expect(linhas).toHaveLength(1)
      expect(linhas[0]?.representedBy).toBe('Diretor de Marketing')
      expect(linhas[0]?.documentId).toBe(documentoId)
    } finally {
      if (documentoId) {
        await db
          .delete(schema.legalAcceptances)
          .where(eq(schema.legalAcceptances.documentId, documentoId))
        await db.delete(schema.legalDocuments).where(eq(schema.legalDocuments.id, documentoId))
      }
      await close()
    }
  }, 120_000)

  it('muda a periodicidade de uma verificação e a nova vale já', async () => {
    // Existe por causa de um caso concreto: o teste de formulários corre uma
    // vez por dia, e num cliente cujo funil de contactos é o negócio isso são
    // vinte e quatro horas de pedidos perdidos antes de darmos por uma avaria
    // de entrega.
    const page = await entrarComo(email)
    await page.goto(`${baseUrl}/sites/${siteId}/seguranca`)
    await page.waitForSelector('text=Verificações')

    const linha = page.locator('[data-check-row=uptime]')
    await linha.locator('select[name=intervalMinutes]').selectOption('15')
    await page.waitForSelector('text=Periodicidade alterada')
    await page.close()

    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
    try {
      const [config] = await db
        .select({
          intervalMinutes: schema.checkConfigs.intervalMinutes,
          nextRunAt: schema.checkConfigs.nextRunAt,
        })
        .from(schema.checkConfigs)
        .where(
          and(
            eq(schema.checkConfigs.siteId, siteId),
            eq(schema.checkConfigs.checkType, 'uptime'),
          ),
        )
        .limit(1)

      expect(config?.intervalMinutes).toBe(15)
      // `nextRunAt` a nulo: baixar a periodicidade por urgência não pode ficar
      // à espera do ciclo antigo que já estava agendado.
      expect(config?.nextRunAt).toBeNull()
    } finally {
      await close()
    }
  }, 120_000)

  it('define um horário de manutenção recorrente', async () => {
    // Sem horário recorrente, «aplica sozinha» exigia alguém a declarar uma
    // data de cada vez — o contrário de automático.
    const page = await entrarComo(email)
    await page.goto(`${baseUrl}/sites/${siteId}/definicoes`)
    await page.waitForSelector('text=Horário recorrente')
    expect(await page.isVisible('text=Sem horário')).toBe(true)

    await page.click('text=Definir horário')
    await page.check('input[name=weekday][value="2"]')
    await page.fill('input[name=hour]', '3')
    await page.selectOption('select[name=durationMinutes]', '120')
    await page.selectOption('select[name=timezone]', 'Europe/Lisbon')
    await page.click('text=Guardar horário')
    await page.waitForSelector('text=ter, às 03:00')
    await page.close()

    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
    try {
      const [site] = await db
        .select({ maintenanceSchedule: schema.sites.maintenanceSchedule })
        .from(schema.sites)
        .where(eq(schema.sites.id, siteId))
        .limit(1)

      // O fuso é guardado pelo nome e não por diferença horária: é o que faz
      // «três da manhã» continuar a ser três da manhã depois da mudança da
      // hora.
      expect(site?.maintenanceSchedule).toMatchObject({
        weekdays: [2],
        hour: 3,
        durationMinutes: 120,
        timezone: 'Europe/Lisbon',
      })
    } finally {
      await close()
    }
  }, 120_000)

  it('declara e remove uma janela de manutenção', async () => {
    // O worker respeita as janelas desde o início; o que não havia era como
    // declarar uma sem um `update` à mão na base de dados.
    // O browser vai para o Dubai, de propósito.
    //
    // O contentor de testes corre em UTC. Com o browser também em UTC, uma
    // conversão de fuso partida dá exatamente o mesmo resultado que uma
    // conversão correta, e o teste passava a dizer nada. Num fuso com
    // desfasamento — e é o caso real de quem trabalha entre Lisboa e o
    // Dubai — a diferença aparece: 22:00 escritas ali são 18:00Z.
    const contexto = await browser.newContext({ timezoneId: 'Asia/Dubai' })
    const page = await contexto.newPage()
    await page.goto(`${baseUrl}/login`)
    await page.fill('#email', email)
    await page.click('button[type=submit]')
    await page.waitForSelector('text=Se este email tiver conta')
    await page.goto(loginLink())
    await page.waitForURL(`${baseUrl}/`)

    await page.goto(`${baseUrl}/sites/${siteId}/definicoes`)
    await page.waitForSelector('text=Janelas de manutenção')
    expect(await page.isVisible('text=Nenhuma janela declarada')).toBe(true)

    // Amanhã à noite, escrito como quem escreve no formulário.
    const amanha = new Date(Date.now() + 24 * 3600_000)
    const dia = amanha.toISOString().slice(0, 10)
    await page.fill('input[aria-label="Início da janela"]', `${dia}T22:00`)
    await page.fill('input[aria-label="Fim da janela"]', `${dia}T23:30`)
    await page.click('form:has(input[name=operacao][value=adicionar]) button[type=submit]')
    // A mensagem da ação, e não o texto de ajuda da página — a primeira
    // versão deste teste esperava por uma frase que já lá estava, e por isso
    // passava a espera com o formulário por submeter.
    await page.waitForSelector('text=Janela declarada')

    await page.waitForSelector('text=agendada')

    // O que ficou guardado é ISO em UTC, e corresponde à hora escrita no
    // fuso do browser — não à hora do servidor.
    const { db, close } = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
    try {
      const [site] = await db
        .select({ maintenanceWindows: schema.sites.maintenanceWindows })
        .from(schema.sites)
        .where(eq(schema.sites.id, siteId))
        .limit(1)
      expect(site?.maintenanceWindows).toHaveLength(1)
      const janela = site!.maintenanceWindows[0]!
      // 22:00 no Dubai são 18:00 em UTC. Guardar `${dia}T22:00Z` seria o
      // defeito que esta asserção existe para apanhar.
      expect(janela.start).toBe(`${dia}T18:00:00.000Z`)
      expect(janela.end).toBe(`${dia}T19:30:00.000Z`)
    } finally {
      await close()
    }

    // Pelo formulário e não por posição: o horário recorrente tem o seu
    // próprio «Remover» na mesma página, e um `nth=0` apanhava o errado
    // consoante a ordem por que os testes corressem.
    await page.click('form:has(input[name=operacao][value=remover]) button[type=submit]')
    await page.waitForSelector('text=Janela removida')
    expect(await page.isVisible('text=Nenhuma janela declarada')).toBe(true)
    await contexto.close()
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

    // A prova de propriedade fica na visão geral, porque é o que trava tudo
    // o resto; a lista do que está bloqueado vive na secção das verificações.
    await page.goto(`${baseUrl}/sites/${siteId}/seguranca`)
    await page.waitForSelector('[data-check-row]')

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

    await page.goto(`${baseUrl}/sites/${siteId}/relatorios`)
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
