import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { createDatabase } from './client.js'
import {
  checkConfigs,
  checkRuns,
  connectors,
  findings,
  formRuns,
  forms,
  notificationDeliveries,
  notificationTargets,
  organizations,
  reportRequests,
  reports,
  siteVerifications,
  sites,
  uptimeSamples,
  wpBackups,
  wpComponents,
  wpUpdates,
} from './schema.js'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

afterAll(async () => {
  await close()
})

/**
 * Apagar um site tem de levar tudo o que pende dele.
 *
 * O painel promete ao cliente que os dados dele desaparecem, e quem apaga é um
 * `delete` numa linha só, a contar com o `on delete cascade`. Basta uma tabela
 * nova sem cascade para esse `delete` passar a rebentar com violação de chave
 * estrangeira — e rebenta no dia em que alguém está a cumprir um pedido de
 * apagamento, que é o pior dia possível para descobrir.
 *
 * Por isso o teste enche **todas** as tabelas que referem um site antes de
 * apagar. Um site acabado de criar apagava-se sem provar nada.
 */
it('apaga um site com linhas em todas as tabelas que dependem dele', async () => {
  const marca = `${Date.now()}-${Math.round(Math.random() * 1e6)}`

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Apagar', slug: `apagar-${marca}` })
    .returning({ id: organizations.id })
  const organizationId = org!.id

  const [site] = await db
    .insert(sites)
    .values({
      organizationId,
      label: 'Site a apagar',
      url: `https://apagar-${marca}.pt`,
      hostname: `apagar-${marca}.pt`,
      state: 'active',
    })
    .returning({ id: sites.id })
  const siteId = site!.id

  await db.insert(siteVerifications).values({
    siteId,
    method: 'dns_txt',
    token: `token-${marca}`,
    state: 'verified',
    verifiedAt: new Date(),
  })
  await db.insert(checkConfigs).values({ siteId, checkType: 'uptime', intervalMinutes: 5 })
  await db.insert(connectors).values({
    siteId,
    type: 'wp_umbrella',
    externalId: marca,
    externalName: 'Projeto',
  })
  await db.insert(wpComponents).values({
    siteId,
    kind: 'core',
    key: 'wordpress',
    name: 'WordPress',
    version: '6.4.3',
    active: true,
  })
  await db.insert(wpBackups).values({
    siteId,
    externalId: `backup-${marca}`,
    startedAt: new Date(),
    status: 'FINISHED',
  })
  await db.insert(wpUpdates).values({
    siteId,
    kind: 'plugin',
    key: 'contact-form-7/wp-contact-form-7.php',
    name: 'contact-form-7',
    processId: `proc-${marca}`,
    status: 'succeeded',
  })
  await db.insert(checkRuns).values({
    siteId,
    checkType: 'uptime',
    status: 'ok',
    startedAt: new Date(),
    durationMs: 210,
  })
  await db.insert(uptimeSamples).values({
    siteId,
    region: 'eu-west',
    observedAt: new Date(),
    up: true,
  })

  const [finding] = await db
    .insert(findings)
    .values({
      siteId,
      checkType: 'uptime',
      code: 'site_down',
      fingerprint: `fp-${marca}`,
      severity: 'high',
      title: 'Site em baixo',
      state: 'open',
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .returning({ id: findings.id })

  // O destino de notificação é da organização mas aponta a este site, e a
  // entrega aponta ao problema. São os dois saltos que o cascade tem de dar
  // sem ser pela coluna `site_id`.
  const [target] = await db
    .insert(notificationTargets)
    .values({ organizationId, siteId, channel: 'email', destination: 'equipa@jelly.pt' })
    .returning({ id: notificationTargets.id })
  const [delivery] = await db
    .insert(notificationDeliveries)
    .values({
      targetId: target!.id,
      findingId: finding!.id,
      kind: 'finding_opened',
      succeeded: true,
    })
    .returning({ id: notificationDeliveries.id })

  const [form] = await db
    .insert(forms)
    .values({
      siteId,
      label: 'Contacto',
      pageUrl: `https://apagar-${marca}.pt/contacto`,
      selector: 'form#contacto',
    })
    .returning({ id: forms.id })
  await db.insert(formRuns).values({
    formId: form!.id,
    siteId,
    canaryToken: `canario-${marca}`,
    canaryAddress: `c-${marca}@check.jellycare.pt`,
    startedAt: new Date(),
  })

  await db.insert(reports).values({
    siteId,
    periodYear: 2026,
    periodMonth: 8,
    pdf: Buffer.from('%PDF-1.4'),
    fileName: 'relatorio.pdf',
    highlights: {
      summary: [],
      uptimePercent: 99.9,
      slaMet: true,
      incidents: 0,
      findingsResolved: 0,
      findingsOpen: 1,
    },
  })
  await db.insert(reportRequests).values({ siteId })

  await db.delete(sites).where(eq(sites.id, siteId))

  expect(await db.select().from(sites).where(eq(sites.id, siteId))).toHaveLength(0)
  expect(await db.select().from(checkRuns).where(eq(checkRuns.siteId, siteId))).toHaveLength(0)
  expect(await db.select().from(findings).where(eq(findings.siteId, siteId))).toHaveLength(0)
  expect(await db.select().from(reports).where(eq(reports.siteId, siteId))).toHaveLength(0)
  expect(await db.select().from(wpUpdates).where(eq(wpUpdates.siteId, siteId))).toHaveLength(0)
  expect(
    await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, delivery!.id)),
  ).toHaveLength(0)

  await db.delete(organizations).where(eq(organizations.id, organizationId))
})
