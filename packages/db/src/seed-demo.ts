/**
 * Semente de demonstração.
 *
 * Cria um site verificado e ativo com histórico realista: disponibilidade com
 * uma interrupção, problemas abertos de várias severidades, formulários
 * inventariados e submissões com e sem entrega de email.
 *
 * Serve para ver o painel com conteúdo, para desenvolver o relatório mensal
 * contra dados verosímeis, e para mostrar o produto sem apontar a um site real
 * de um cliente.
 *
 *   DATABASE_URL=... SEED_EMAIL=voce@jelly.pt pnpm --filter @jellycare/db exec tsx src/seed-demo.ts
 */
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createDatabase } from './client.js'
import {
  checkConfigs,
  checkRuns,
  findings,
  formRuns,
  forms,
  memberships,
  notificationTargets,
  organizations,
  siteVerifications,
  sites,
  uptimeSamples,
  users,
} from './schema.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const CHECKS: { checkType: string; intervalMinutes: number }[] = [
  { checkType: 'uptime', intervalMinutes: 5 },
  { checkType: 'tls', intervalMinutes: 60 * 24 },
  { checkType: 'email_auth', intervalMinutes: 60 * 24 },
  { checkType: 'security_headers', intervalMinutes: 60 * 24 },
  { checkType: 'exposed_files', intervalMinutes: 60 * 24 },
  { checkType: 'reputation', intervalMinutes: 60 * 24 },
  { checkType: 'broken_links', intervalMinutes: 60 * 24 * 7 },
  { checkType: 'form_discovery', intervalMinutes: 60 * 24 * 7 },
  { checkType: 'form_test', intervalMinutes: 60 * 24 },
  { checkType: 'form_delivery', intervalMinutes: 60 },
]

interface DemoFinding {
  checkType: string
  code: string
  discriminator?: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  title: string
  detail: string
  ageDays: number
  occurrences: number
}

const DEMO_FINDINGS: DemoFinding[] = [
  {
    checkType: 'form_delivery',
    code: 'form_email_not_delivered',
    discriminator: 'form-contacto',
    severity: 'high',
    title: 'O formulário "Enviar · /contactos" não gerou notificação por email',
    detail:
      'A submissão foi aceite pelo site mas não chegou nenhuma mensagem à caixa de verificação ' +
      'em 15 minutos. É o cenário em que o cliente pensa que não tem pedidos quando na verdade ' +
      'não os está a receber.',
    ageDays: 2,
    occurrences: 3,
  },
  {
    checkType: 'tls',
    code: 'cert_expiring',
    severity: 'medium',
    title: 'O certificado expira em 12 dias',
    detail: "Válido até 2026-09-29, emitido por Let's Encrypt.",
    ageDays: 3,
    occurrences: 3,
  },
  {
    checkType: 'security_headers',
    code: 'missing_frame_protection',
    severity: 'medium',
    title: 'O site pode ser embebido num iframe por terceiros',
    detail:
      'Sem X-Frame-Options nem frame-ancestors na CSP, o site pode ser usado num ataque de ' +
      'clickjacking.',
    ageDays: 21,
    occurrences: 21,
  },
  {
    checkType: 'broken_links',
    code: 'link_broken',
    discriminator: 'https://demo-cliente.pt/servicos/consultoria-antiga',
    severity: 'medium',
    title: 'Link quebrado: HTTP 404',
    detail:
      'https://demo-cliente.pt/servicos/consultoria-antiga está referenciado em ' +
      'https://demo-cliente.pt/servicos no texto "Consultoria".',
    ageDays: 5,
    occurrences: 1,
  },
  {
    checkType: 'broken_links',
    code: 'asset_missing',
    discriminator: 'https://demo-cliente.pt/wp-content/uploads/2024/equipa.jpg',
    severity: 'medium',
    title: 'Imagem em falta: HTTP 404',
    detail:
      'https://demo-cliente.pt/wp-content/uploads/2024/equipa.jpg está referenciado em ' +
      'https://demo-cliente.pt/sobre no texto "A nossa equipa".',
    ageDays: 5,
    occurrences: 1,
  },
  {
    checkType: 'email_auth',
    code: 'dmarc_policy_none',
    severity: 'low',
    title: 'A política DMARC está em modo de observação',
    detail:
      'Com p=none o DMARC só produz relatórios; não impede ninguém de enviar email em nome do ' +
      'domínio. É o passo intermédio correto, mas não é o destino.',
    ageDays: 30,
    occurrences: 30,
  },
  {
    checkType: 'security_headers',
    code: 'server_version_disclosed',
    severity: 'low',
    title: 'O servidor divulga a versão do software',
    detail: 'Headers a expor versões: nginx/1.18.0.',
    ageDays: 30,
    occurrences: 30,
  },
]

export interface DemoSeedOptions {
  databaseUrl: string
  email: string
  organizationName?: string
}

export async function seedDemo(
  options: DemoSeedOptions,
): Promise<{ siteId: string; organizationId: string }> {
  const { db, close } = createDatabase({ url: options.databaseUrl, maxConnections: 2 })
  const now = new Date()
  const email = options.email.toLowerCase().trim()

  try {
    const orgName = options.organizationName ?? 'Demo Cliente'
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    // Idempotente: uma segunda execução recomeça do zero em vez de acumular.
    const previous = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1)
    if (previous[0]) {
      await db.delete(organizations).where(eq(organizations.id, previous[0].id))
    }

    const [org] = await db
      .insert(organizations)
      .values({ name: orgName, slug })
      .returning({ id: organizations.id })
    const organizationId = org!.id

    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    const userId =
      existingUser[0]?.id ??
      (await db.insert(users).values({ email }).returning({ id: users.id }))[0]!.id

    await db
      .insert(memberships)
      .values({ organizationId, userId, role: 'owner' })
      .onConflictDoNothing()

    await db.insert(notificationTargets).values({
      organizationId,
      channel: 'email',
      destination: email,
      minSeverity: 'high',
    })

    const [site] = await db
      .insert(sites)
      .values({
        organizationId,
        label: 'Demo Cliente — site institucional',
        url: 'https://demo-cliente.pt',
        hostname: 'demo-cliente.pt',
        state: 'active',
        platform: 'WordPress 6.6',
        expectedContent: 'Demo Cliente',
      })
      .returning({ id: sites.id })
    const siteId = site!.id

    await db.insert(siteVerifications).values({
      siteId,
      method: 'dns_txt',
      token: `jellycare-site-verification=${randomBytes(16).toString('hex')}`,
      state: 'verified',
      verifiedAt: new Date(now.getTime() - 45 * DAY),
      lastCheckedAt: now,
    })

    await db.insert(checkConfigs).values(
      CHECKS.map((check) => ({
        siteId,
        checkType: check.checkType,
        intervalMinutes: check.intervalMinutes,
        enabled: true,
        config: check.checkType === 'uptime' ? { expectedContent: 'Demo Cliente' } : {},
        lastRunAt: new Date(now.getTime() - 3 * MINUTE),
        nextRunAt: new Date(now.getTime() + check.intervalMinutes * MINUTE),
      })),
    )

    await db.insert(findings).values(
      DEMO_FINDINGS.map((finding) => ({
        siteId,
        checkType: finding.checkType,
        // O fingerprint real vem de @jellycare/core; aqui basta ser estável e
        // único, porque esta semente não passa pela reconciliação.
        fingerprint: randomBytes(16).toString('hex'),
        code: finding.code,
        discriminator: finding.discriminator ?? null,
        severity: finding.severity,
        state: 'open' as const,
        title: finding.title,
        detail: finding.detail,
        firstSeenAt: new Date(now.getTime() - finding.ageDays * DAY),
        lastSeenAt: new Date(now.getTime() - 20 * MINUTE),
        occurrences: finding.occurrences,
      })),
    )

    // Disponibilidade das últimas 24 horas, de cinco em cinco minutos, com uma
    // interrupção de 25 minutos a meio da madrugada.
    const samples: (typeof uptimeSamples.$inferInsert)[] = []
    const outageStart = now.getTime() - 9 * HOUR
    const outageEnd = outageStart + 25 * MINUTE

    for (let offset = 24 * HOUR; offset >= 0; offset -= 5 * MINUTE) {
      const observedAt = new Date(now.getTime() - offset)
      const down = observedAt.getTime() >= outageStart && observedAt.getTime() <= outageEnd
      samples.push({
        siteId,
        region: 'eu-west',
        observedAt,
        up: !down,
        statusCode: down ? 503 : 200,
        responseTimeMs: down ? null : 180 + Math.round(Math.sin(offset / HOUR) * 60) + 40,
        failureReason: down ? 'HTTP 503' : null,
      })
    }
    await db.insert(uptimeSamples).values(samples)

    await db.insert(checkRuns).values([
      {
        siteId,
        checkType: 'uptime',
        status: 'ok' as const,
        region: 'eu-west',
        startedAt: new Date(now.getTime() - 3 * MINUTE),
        durationMs: 214,
        metrics: { up: 1, statusCode: 200, responseTimeMs: 214 },
      },
      {
        siteId,
        checkType: 'form_delivery',
        status: 'ok' as const,
        region: 'eu-west',
        startedAt: new Date(now.getTime() - 22 * MINUTE),
        durationMs: 96,
        metrics: { runsEvaluated: 1, missingDeliveries: 1 },
      },
      {
        siteId,
        checkType: 'form_test',
        status: 'ok' as const,
        region: 'eu-west',
        startedAt: new Date(now.getTime() - 4 * HOUR),
        durationMs: 8_431,
        metrics: { formsTested: 1, formsFailed: 0 },
      },
      {
        siteId,
        checkType: 'broken_links',
        status: 'ok' as const,
        region: 'eu-west',
        startedAt: new Date(now.getTime() - 2 * DAY),
        durationMs: 41_882,
        metrics: { pagesCrawled: 64, urlsChecked: 312, brokenCount: 2 },
      },
      {
        siteId,
        checkType: 'reputation',
        status: 'failed' as const,
        region: 'eu-west',
        startedAt: new Date(now.getTime() - 26 * HOUR),
        durationMs: 15_004,
        error: 'Nenhuma fonte de reputação respondeu: urlhaus: URLhaus respondeu 503',
        metrics: {},
      },
    ])

    const [contactForm] = await db
      .insert(forms)
      .values([
        {
          siteId,
          label: 'Enviar · /contactos',
          pageUrl: 'https://demo-cliente.pt/contactos',
          selector: '#contacto',
          fieldMap: { nome: 'name', email: 'email', telefone: 'phone', mensagem: 'message' },
          enabled: true,
          excluded: false,
        },
        {
          siteId,
          label: 'newsletter · /',
          pageUrl: 'https://demo-cliente.pt/',
          selector: 'form.newsletter',
          fieldMap: { email: 'email' },
          enabled: false,
          excluded: true,
        },
        {
          siteId,
          label: 'form:nth-of-type(1) · /',
          pageUrl: 'https://demo-cliente.pt/pesquisa',
          selector: 'form:nth-of-type(1)',
          fieldMap: { s: 'unknown' },
          enabled: false,
          excluded: true,
        },
      ])
      .returning({ id: forms.id })

    await db.insert(formRuns).values([
      {
        formId: contactForm!.id,
        siteId,
        canaryToken: randomBytes(8).toString('hex'),
        canaryAddress: `check+${siteId}-a@check.jellycare.pt`,
        startedAt: new Date(now.getTime() - 4 * HOUR),
        submitted: true,
        emailReceived: false,
      },
      {
        formId: contactForm!.id,
        siteId,
        canaryToken: randomBytes(8).toString('hex'),
        canaryAddress: `check+${siteId}-b@check.jellycare.pt`,
        startedAt: new Date(now.getTime() - 28 * HOUR),
        submitted: true,
        emailReceived: true,
        emailReceivedAt: new Date(now.getTime() - 28 * HOUR + 9_000),
        deliveryLatencyMs: 9_000,
        spf: 'pass',
        dkim: 'pass',
        dmarc: 'pass',
        landedInSpam: false,
      },
    ])

    return { siteId, organizationId }
  } finally {
    await close()
  }
}

const isDirectRun =
  process.argv[1]?.endsWith('seed-demo.ts') || process.argv[1]?.endsWith('seed-demo.js')

if (isDirectRun) {
  const databaseUrl = process.env.DATABASE_URL
  const email = process.env.SEED_EMAIL

  if (!databaseUrl || !email) {
    console.error('Defina DATABASE_URL e SEED_EMAIL.')
    process.exit(1)
  }

  seedDemo({ databaseUrl, email })
    .then(({ siteId }) => {
      console.info(`Demonstração pronta. Site: ${siteId}. Entre com ${email}.`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('Falha ao aplicar a semente de demonstração:', error)
      process.exit(1)
    })
}
