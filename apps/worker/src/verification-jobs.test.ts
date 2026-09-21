import { createDatabase, schema } from '@jellycare/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sweepPendingVerifications } from './verification-jobs.js'

/**
 * A verificação automática que o painel promete desde o primeiro dia e que
 * não existia. Quem publicava o registo e fechava a janela ficava à espera
 * para sempre.
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

const TOKEN = 'jellycare-site-verification=abc'

let organizationId: string
let siteId: string

beforeEach(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Cliente', slug: `verif-${Date.now()}-${Math.random()}` })
    .returning({ id: schema.organizations.id })
  organizationId = org!.id

  const [site] = await db
    .insert(schema.sites)
    .values({
      organizationId,
      label: 'Site',
      url: 'https://cliente.pt',
      hostname: 'cliente.pt',
      state: 'onboarding',
    })
    .returning({ id: schema.sites.id })
  siteId = site!.id

  await db
    .insert(schema.siteVerifications)
    .values({ siteId, method: 'dns_txt', token: TOKEN, state: 'pending' })
})

afterAll(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  await close()
})

async function estado() {
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId))
  const [verificacao] = await db
    .select()
    .from(schema.siteVerifications)
    .where(eq(schema.siteVerifications.siteId, siteId))
  return { site, verificacao }
}

const comFicheiro = (async () =>
  new Response(TOKEN, { status: 200 })) as typeof globalThis.fetch
const semFicheiro = (async () =>
  new Response('não encontrado', { status: 404 })) as typeof globalThis.fetch

describe('sweepPendingVerifications', () => {
  it('confirma pelo ficheiro e ativa o site', async () => {
    // O caso do cliente que não mexe no DNS e publica o ficheiro. A rotina
    // tem de o apanhar sem ninguém carregar em nada.
    const resultado = await sweepPendingVerifications({ db, fetch: comFicheiro })

    expect(resultado.verified).toBeGreaterThanOrEqual(1)

    const { site, verificacao } = await estado()
    expect(site?.state).toBe('active')
    expect(verificacao?.state).toBe('verified')
    // O método guardado é aquele por onde a prova entrou, e não o escolhido
    // na criação.
    expect(verificacao?.method).toBe('http_file')
    expect(verificacao?.verifiedAt).not.toBeNull()
  }, 30_000)

  it('quando nada é encontrado, regista a tentativa e não ativa', async () => {
    await sweepPendingVerifications({ db, fetch: semFicheiro })

    const { site, verificacao } = await estado()
    expect(site?.state).toBe('onboarding')
    expect(verificacao?.state).toBe('pending')
    // A tentativa fica registada: é o que distingue "ainda não verificámos"
    // de "verificámos e não estava lá".
    expect(verificacao?.lastCheckedAt).not.toBeNull()
  }, 30_000)

  it('não toca num site já verificado', async () => {
    await sweepPendingVerifications({ db, fetch: comFicheiro })
    const primeira = (await estado()).verificacao?.lastCheckedAt

    await sweepPendingVerifications({ db, fetch: comFicheiro })
    const { verificacao } = await estado()

    expect(verificacao?.state).toBe('verified')
    // Já não está pendente, logo a segunda passagem não lhe volta a tocar.
    // A asserção é sobre esta linha e não sobre a contagem global: o turbo
    // corre os pacotes em paralelo contra a mesma base de dados de teste, e
    // qualquer total falha de forma intermitente.
    expect(verificacao?.lastCheckedAt?.getTime()).toBe(primeira?.getTime())
  }, 30_000)

  it('ignora sites arquivados', async () => {
    // Já ninguém os quer; andar a verificá-los é gastar pedidos contra o
    // site de um ex-cliente.
    await db.update(schema.sites).set({ state: 'archived' }).where(eq(schema.sites.id, siteId))

    await sweepPendingVerifications({ db, fetch: comFicheiro })

    const { site, verificacao } = await estado()
    expect(site?.state).toBe('archived')
    // Nem sequer foi tentado: continua sem data de última tentativa.
    expect(verificacao?.state).toBe('pending')
    expect(verificacao?.lastCheckedAt).toBeNull()
  }, 30_000)

  it('uma falha de rede não leva os outros sites atrás', async () => {
    const explode = (async () => {
      throw new Error('ENOTFOUND')
    }) as typeof globalThis.fetch

    const resultado = await sweepPendingVerifications({ db, fetch: explode })
    expect(resultado.failed).toBeGreaterThanOrEqual(1)

    const { site } = await estado()
    expect(site?.state).toBe('onboarding')
  }, 30_000)
})
