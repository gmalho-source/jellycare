import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from './client.js'
import {
  claimNextReportRequest,
  completeReportRequest,
  latestReportRequest,
  requestReport,
} from './report-requests.js'
import { organizations, reportRequests, sites } from './schema.js'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

let organizationId: string
let siteId: string

beforeEach(async () => {
  if (organizationId) {
    await db.delete(organizations).where(eq(organizations.id, organizationId))
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Pedidos', slug: `pedidos-${Date.now()}-${Math.random()}` })
    .returning({ id: organizations.id })
  organizationId = org!.id

  const [site] = await db
    .insert(sites)
    .values({
      organizationId,
      label: 'Site',
      url: 'https://cliente.pt',
      hostname: 'cliente.pt',
      state: 'active',
    })
    .returning({ id: sites.id })
  siteId = site!.id
})

afterAll(async () => {
  if (organizationId) {
    await db.delete(organizations).where(eq(organizations.id, organizationId))
  }
  await close()
})

describe('requestReport', () => {
  it('guarda o destinatário escolhido', async () => {
    const { request, created } = await requestReport(db, {
      siteId,
      recipients: ['alguem@cliente.pt'],
    })

    expect(created).toBe(true)
    expect(request.recipients).toEqual(['alguem@cliente.pt'])
  })

  it('sem destinatário, fica vazio — que significa os configurados no site', async () => {
    const { request } = await requestReport(db, { siteId })

    expect(request.recipients).toEqual([])
  })

  it('dois cliques seguidos não criam dois pedidos', async () => {
    // Sem isto o cliente recebia o relatório duas vezes. A garantia está no
    // índice parcial da base de dados, não só nesta função.
    const primeiro = await requestReport(db, { siteId })
    const segundo = await requestReport(db, { siteId })

    expect(segundo.created).toBe(false)
    expect(segundo.request.id).toBe(primeiro.request.id)

    const todos = await db.select().from(reportRequests).where(eq(reportRequests.siteId, siteId))
    expect(todos).toHaveLength(1)
  })

  it('depois de concluído, um novo pedido é aceite', async () => {
    const primeiro = await requestReport(db, { siteId })
    await completeReportRequest(db, primeiro.request.id, {
      periodYear: 2026,
      periodMonth: 8,
      sentTo: ['alguem@cliente.pt'],
    })

    const segundo = await requestReport(db, { siteId })

    expect(segundo.created).toBe(true)
    expect(segundo.request.id).not.toBe(primeiro.request.id)
  })
})

describe('claimNextReportRequest', () => {
  it('reclama o pedido uma única vez', async () => {
    // Dois workers a reclamar ao mesmo tempo não podem levar o mesmo pedido,
    // senão o cliente recebe o relatório duas vezes.
    //
    // A asserção é sobre este pedido e não sobre o total: a função varre a
    // tabela inteira, como tem de ser, e a base de testes é partilhada com os
    // outros pacotes a correr em paralelo.
    const { request } = await requestReport(db, { siteId })

    const primeiro = await claimNextReportRequest(db)
    const segundo = await claimNextReportRequest(db)

    expect(primeiro?.id).toBe(request.id)
    expect(segundo?.id).not.toBe(request.id)
  })

  it('devolve a linha com os nomes do código, e não os da base de dados', async () => {
    // O bug que isto apanha: com SQL cru, o `db.execute` devolve `site_id` e
    // o worker ficava com `siteId` a undefined — gerava relatório nenhum e não
    // se queixava de nada. Um teste que só verifique "não é nulo" deixa passar.
    await requestReport(db, { siteId, recipients: ['x@cliente.pt'] })

    const reclamado = await claimNextReportRequest(db)

    expect(reclamado?.siteId).toBe(siteId)
    expect(reclamado?.recipients).toEqual(['x@cliente.pt'])
    expect(reclamado?.startedAt).toBeInstanceOf(Date)
  })

  it('não reclama nada deste site quando ele não pediu nada', async () => {
    const reclamado = await claimNextReportRequest(db)

    expect(reclamado?.siteId).not.toBe(siteId)
  })

  it('volta a reclamar um pedido abandonado por um worker que morreu', async () => {
    // Sem isto, um worker que morra a meio bloqueia o site para sempre: o
    // índice parcial não deixa criar outro pedido enquanto houver um pendente.
    const { request } = await requestReport(db, { siteId })
    await db
      .update(reportRequests)
      .set({ startedAt: new Date(Date.now() - 30 * 60_000) })
      .where(eq(reportRequests.id, request.id))

    const reclamado = await claimNextReportRequest(db)

    expect(reclamado?.id).toBe(request.id)
  })
})

describe('latestReportRequest', () => {
  it('devolve o estado do último pedido, para o painel o mostrar', async () => {
    const { request } = await requestReport(db, { siteId, recipients: ['x@cliente.pt'] })
    await completeReportRequest(db, request.id, {
      periodYear: 2026,
      periodMonth: 8,
      sentTo: ['x@cliente.pt'],
    })

    const ultimo = await latestReportRequest(db, siteId)

    expect(ultimo?.completedAt).not.toBeNull()
    expect(ultimo?.sentTo).toEqual(['x@cliente.pt'])
    expect(ultimo?.error).toBeNull()
  })

  it('devolve null quando nunca houve pedido', async () => {
    expect(await latestReportRequest(db, siteId)).toBeNull()
  })
})
