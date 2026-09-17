/**
 * Semente de desenvolvimento.
 *
 * Cria uma organização, um utilizador da equipa e um site de exemplo com
 * todas as verificações configuradas. Idempotente: correr duas vezes não
 * duplica nada.
 *
 *   DATABASE_URL=... pnpm --filter @jellycare/db exec tsx src/seed.ts
 */
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createDatabase } from './client.js'
import {
  checkConfigs,
  memberships,
  organizations,
  siteVerifications,
  sites,
  users,
} from './schema.js'

const CHECK_DEFAULTS: { checkType: string; intervalMinutes: number }[] = [
  { checkType: 'uptime', intervalMinutes: 5 },
  { checkType: 'tls', intervalMinutes: 60 * 24 },
  { checkType: 'email_auth', intervalMinutes: 60 * 24 },
  { checkType: 'security_headers', intervalMinutes: 60 * 24 },
  { checkType: 'exposed_files', intervalMinutes: 60 * 24 },
  { checkType: 'reputation', intervalMinutes: 60 * 24 },
  { checkType: 'broken_links', intervalMinutes: 60 * 24 * 7 },
]

export interface SeedOptions {
  databaseUrl: string
  email: string
  organizationName?: string
  siteLabel?: string
  siteUrl?: string
}

export async function seed(options: SeedOptions): Promise<{ userId: string; siteId: string }> {
  const { db, close } = createDatabase({ url: options.databaseUrl, maxConnections: 2 })
  const email = options.email.toLowerCase().trim()

  try {
    const orgName = options.organizationName ?? 'Jelly'
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    const existingOrg = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1)

    const organizationId =
      existingOrg[0]?.id ??
      (
        await db
          .insert(organizations)
          .values({ name: orgName, slug })
          .returning({ id: organizations.id })
      )[0]!.id

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

    const siteUrl = options.siteUrl ?? 'https://jelly.pt'
    const hostname = new URL(siteUrl).hostname

    const existingSite = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.url, siteUrl))
      .limit(1)

    const siteId =
      existingSite[0]?.id ??
      (
        await db
          .insert(sites)
          .values({
            organizationId,
            label: options.siteLabel ?? 'Jelly',
            url: siteUrl,
            hostname,
            state: 'onboarding',
          })
          .returning({ id: sites.id })
      )[0]!.id

    // Sem um desafio pendente, o painel de onboarding não teria o que mostrar
    // e o site ficaria preso em "por verificar" sem instruções.
    const existingVerification = await db
      .select({ id: siteVerifications.id })
      .from(siteVerifications)
      .where(eq(siteVerifications.siteId, siteId))
      .limit(1)

    if (!existingVerification[0]) {
      await db.insert(siteVerifications).values({
        siteId,
        method: 'dns_txt',
        token: `jellycare-site-verification=${randomBytes(16).toString('hex')}`,
        state: 'pending',
      })
    }

    for (const check of CHECK_DEFAULTS) {
      await db
        .insert(checkConfigs)
        .values({ siteId, checkType: check.checkType, intervalMinutes: check.intervalMinutes })
        .onConflictDoNothing()
    }

    return { userId, siteId }
  } finally {
    await close()
  }
}

const isDirectRun = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')

if (isDirectRun) {
  const databaseUrl = process.env.DATABASE_URL
  const email = process.env.SEED_EMAIL

  if (!databaseUrl || !email) {
    console.error('Defina DATABASE_URL e SEED_EMAIL.')
    process.exit(1)
  }

  seed({ databaseUrl, email })
    .then(({ siteId }) => {
      console.info(`Semente aplicada. Site: ${siteId}. Entre com ${email}.`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('Falha ao aplicar a semente:', error)
      process.exit(1)
    })
}
