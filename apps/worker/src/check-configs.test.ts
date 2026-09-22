import { createDatabase, schema } from '@jellycare/db'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { allCheckTypes, ensureCheckConfigs } from './check-configs.js'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

let organizationId: string
let siteId: string

beforeEach(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Backfill', slug: `bf-${Date.now()}-${Math.random()}` })
    .returning({ id: schema.organizations.id })
  organizationId = org!.id

  const [site] = await db
    .insert(schema.sites)
    .values({
      organizationId,
      label: 'Site antigo',
      url: 'https://antigo.pt',
      hostname: 'antigo.pt',
      state: 'active',
    })
    .returning({ id: schema.sites.id })
  siteId = site!.id
})

afterAll(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  await close()
})

async function tiposDoSite() {
  const linhas = await db
    .select({ checkType: schema.checkConfigs.checkType })
    .from(schema.checkConfigs)
    .where(eq(schema.checkConfigs.siteId, siteId))
  return linhas.map((linha) => linha.checkType).sort()
}

describe('ensureCheckConfigs', () => {
  it('dá a um site sem nada todas as verificações registadas', async () => {
    // O caso real: um site criado antes de uma verificação existir. Sem
    // linha, o agendador nunca a vê, e ela nunca corre — sem erro nenhum.
    await ensureCheckConfigs(db)

    expect(await tiposDoSite()).toEqual(
      allCheckTypes()
        .map((tipo) => tipo.type)
        .sort(),
    )
  })

  it('não duplica quando corre outra vez', async () => {
    await ensureCheckConfigs(db)
    const outcome = await ensureCheckConfigs(db)

    expect(outcome.created).toBe(0)
    const tipos = await tiposDoSite()
    expect(new Set(tipos).size).toBe(tipos.length)
  })

  it('não volta a ligar o que alguém desligou', async () => {
    await ensureCheckConfigs(db)
    const alvo = allCheckTypes()[0]!.type
    await db
      .update(schema.checkConfigs)
      .set({ enabled: false })
      .where(
        and(eq(schema.checkConfigs.siteId, siteId), eq(schema.checkConfigs.checkType, alvo)),
      )

    await ensureCheckConfigs(db)

    const linhas = await db
      .select({ enabled: schema.checkConfigs.enabled })
      .from(schema.checkConfigs)
      .where(
        and(eq(schema.checkConfigs.siteId, siteId), eq(schema.checkConfigs.checkType, alvo)),
      )
    expect(linhas[0]?.enabled).toBe(false)
  })

  it('ignora sites arquivados', async () => {
    await db
      .update(schema.sites)
      .set({ state: 'archived' })
      .where(eq(schema.sites.id, siteId))

    await ensureCheckConfigs(db)

    expect(await tiposDoSite()).toEqual([])
  })
})
