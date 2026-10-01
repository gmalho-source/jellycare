import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from './client.js'
import { guardarCaptura, lerCaptura } from './screenshots.js'
import { organizations, sites } from './schema.js'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

let organizationId: string
let siteId: string

const imagem = (byte: number) => ({ mimeType: 'image/jpeg' as const, data: Buffer.from([0xff, 0xd8, byte]) })
const ONTEM = new Date('2026-09-30T10:00:00Z')
const HOJE = new Date('2026-10-01T10:00:00Z')

beforeEach(async () => {
  if (organizationId) await db.delete(organizations).where(eq(organizations.id, organizationId))
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Capturas', slug: `capturas-${Date.now()}-${Math.random()}` })
    .returning({ id: organizations.id })
  organizationId = org!.id
  const [site] = await db
    .insert(sites)
    .values({ organizationId, label: 'Site', url: 'https://cliente.pt', hostname: 'cliente.pt', state: 'active' })
    .returning({ id: sites.id })
  siteId = site!.id
})

afterAll(async () => {
  if (organizationId) await db.delete(organizations).where(eq(organizations.id, organizationId))
  await close()
})

describe('guardarCaptura', () => {
  it('guarda a primeira, venha de onde vier', async () => {
    await guardarCaptura(db, { siteId, source: 'page_speed', capture: imagem(1), now: ONTEM })
    const captura = await lerCaptura(db, siteId)
    expect(captura?.image.equals(imagem(1).data)).toBe(true)
    expect(captura?.capturedAt).toEqual(ONTEM)
  })

  it('a de computador substitui a de telemóvel, e a de telemóvel não volta a substituí-la', async () => {
    await guardarCaptura(db, { siteId, source: 'page_speed', capture: imagem(1), now: ONTEM })
    expect(await guardarCaptura(db, { siteId, source: 'page_speed_desktop', capture: imagem(2), now: ONTEM })).toBe(true)
    expect(await guardarCaptura(db, { siteId, source: 'page_speed', capture: imagem(3), now: HOJE })).toBe(false)

    const captura = await lerCaptura(db, siteId)
    expect(captura?.image.equals(imagem(2).data)).toBe(true)
  })

  it('uma de computador mais recente substitui a anterior', async () => {
    await guardarCaptura(db, { siteId, source: 'page_speed_desktop', capture: imagem(2), now: ONTEM })
    await guardarCaptura(db, { siteId, source: 'page_speed_desktop', capture: imagem(4), now: HOJE })
    const captura = await lerCaptura(db, siteId)
    expect(captura?.image.equals(imagem(4).data)).toBe(true)
    expect(captura?.capturedAt).toEqual(HOJE)
  })

  it('a de telemóvel atualiza enquanto não houver outra', async () => {
    await guardarCaptura(db, { siteId, source: 'page_speed', capture: imagem(1), now: ONTEM })
    await guardarCaptura(db, { siteId, source: 'page_speed', capture: imagem(5), now: HOJE })
    expect((await lerCaptura(db, siteId))?.image.equals(imagem(5).data)).toBe(true)
  })

  it('desaparece com o site', async () => {
    await guardarCaptura(db, { siteId, source: 'page_speed_desktop', capture: imagem(2), now: HOJE })
    await db.delete(sites).where(eq(sites.id, siteId))
    expect(await lerCaptura(db, siteId)).toBeNull()
  })
})
