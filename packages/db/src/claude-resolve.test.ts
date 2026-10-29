import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  anularPedidoAoClaude,
  concluirPedidoAoClaude,
  definirRepositorio,
  pedidosAoClaudeDoSite,
  reservarPedidoAoClaude,
} from './claude-resolve.js'
import { createDatabase } from './client.js'
import { findings, organizations, sites } from './schema.js'

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'
const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

let organizationId: string
let siteId: string
let findingId: string

beforeEach(async () => {
  if (organizationId) await db.delete(organizations).where(eq(organizations.id, organizationId))
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Claude Resolve', slug: `claude-resolve-${Date.now()}-${Math.random()}` })
    .returning({ id: organizations.id })
  organizationId = org!.id
  const [site] = await db
    .insert(sites)
    .values({ organizationId, label: 'Site', url: 'https://cliente.pt', hostname: 'cliente.pt', state: 'active' })
    .returning({ id: sites.id })
  siteId = site!.id
  const [finding] = await db
    .insert(findings)
    .values({
      siteId,
      checkType: 'security_headers',
      code: 'missing_hsts',
      fingerprint: `fp-${Math.random()}`,
      severity: 'medium',
      state: 'open',
      title: 'Falta HSTS',
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .returning({ id: findings.id })
  findingId = finding!.id
})

afterAll(async () => {
  if (organizationId) await db.delete(organizations).where(eq(organizations.id, organizationId))
  await close()
})

const pedido = () => ({ findingId, siteId, repo: 'jelly-pt/site-cliente', requestedBy: null })

describe('pedidos ao Claude Resolve', () => {
  it('guarda o repositório do site', async () => {
    await definirRepositorio(db, siteId, 'jelly-pt/site-cliente')
    const [linha] = await db.select({ repo: sites.githubRepo }).from(sites).where(eq(sites.id, siteId))
    expect(linha?.repo).toBe('jelly-pt/site-cliente')
  })

  it('um pedido por problema: o segundo clique não abre outra issue', async () => {
    expect(await reservarPedidoAoClaude(db, pedido())).not.toBeNull()
    expect(await reservarPedidoAoClaude(db, pedido())).toBeNull()
  })

  it('guarda a issue, e o painel encontra-a pelo problema', async () => {
    const id = await reservarPedidoAoClaude(db, pedido())
    await concluirPedidoAoClaude(db, id!, { number: 7, url: 'https://github.com/jelly-pt/site-cliente/issues/7' })
    expect((await pedidosAoClaudeDoSite(db, siteId)).get(findingId)).toMatchObject({
      issueNumber: 7,
      issueUrl: 'https://github.com/jelly-pt/site-cliente/issues/7',
    })
  })

  it('anulado quando o GitHub recusa, o botão volta', async () => {
    const id = await reservarPedidoAoClaude(db, pedido())
    await anularPedidoAoClaude(db, id!)
    expect(await reservarPedidoAoClaude(db, pedido())).not.toBeNull()
  })

  it('uma reserva que morreu a meio não bloqueia para sempre, mas uma recente sim', async () => {
    const agora = new Date()
    await reservarPedidoAoClaude(db, pedido(), new Date(agora.getTime() - 10 * 60_000))
    expect(await reservarPedidoAoClaude(db, pedido(), agora)).not.toBeNull()
    expect(await reservarPedidoAoClaude(db, pedido(), new Date(agora.getTime() + 60_000))).toBeNull()
  })

  it('um pedido com issue nunca é tomado por abandonado', async () => {
    const id = await reservarPedidoAoClaude(db, pedido(), new Date(Date.now() - 60 * 60_000))
    await concluirPedidoAoClaude(db, id!, { number: 3, url: 'u' })
    expect(await reservarPedidoAoClaude(db, pedido())).toBeNull()
  })
})
