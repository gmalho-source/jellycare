import { createDatabase, schema } from '@jellycare/db'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Site } from '@jellycare/core'
import { runWpAutoUpdate, BACKUP_REQUIRED_WITHIN_DAYS } from './wp-update-jobs.js'

/**
 * Atualizações automáticas, contra Postgres real e uma API falsa.
 *
 * O que estes testes protegem não é o caminho feliz — é o conjunto de
 * condições que impedem a plataforma de escrever no site de um cliente.
 * Cada uma é verificada pelo que **não** acontece: nenhum pedido sai.
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 4 })

let organizationId: string
let site: Site
const AGORA = new Date('2026-09-22T02:00:00Z')

/** Uma janela que contém AGORA. */
const JANELA_ABERTA = [{ start: '2026-09-22T01:00:00Z', end: '2026-09-22T04:00:00Z' }]
/** Uma janela que já passou. */
const JANELA_FECHADA = [{ start: '2026-09-21T01:00:00Z', end: '2026-09-21T04:00:00Z' }]

beforeEach(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Cliente WP', slug: `upd-${Date.now()}-${Math.random()}` })
    .returning({ id: schema.organizations.id })
  organizationId = org!.id

  const [row] = await db
    .insert(schema.sites)
    .values({
      organizationId,
      label: 'Site WordPress',
      url: 'https://cliente.pt',
      hostname: 'cliente.pt',
      state: 'active',
    })
    .returning({ id: schema.sites.id })

  site = {
    id: row!.id,
    organizationId,
    url: 'https://cliente.pt',
    hostname: 'cliente.pt',
    label: 'Site WordPress',
  }
})

afterAll(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  await close()
})

/** Regista todos os pedidos de escrita que saíram. */
let escritas: { path: string; body: unknown }[] = []

function fakeFetch() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (init?.method === 'POST') {
      escritas.push({ path: url.pathname, body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ code: 'success', data: { processId: 'proc-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ code: 'success', data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
}

const originalFetch = globalThis.fetch
beforeEach(() => {
  escritas = []
  globalThis.fetch = fakeFetch()
})
afterAll(() => {
  globalThis.fetch = originalFetch
})

async function ligar() {
  await db.insert(schema.connectors).values({
    siteId: site.id,
    type: 'wp_umbrella',
    externalId: '123',
    externalName: 'Example Website',
  })
}

async function comComponentePorAtualizar() {
  await db.insert(schema.wpComponents).values({
    siteId: site.id,
    kind: 'plugin',
    key: 'contact-form-7/wp-contact-form-7.php',
    name: 'Contact Form 7',
    version: '5.7.0',
    latestVersion: '5.9.0',
    active: true,
    observedAt: AGORA,
  })
}

async function comCopiaRecente(diasAtras = 1) {
  await db.insert(schema.wpBackups).values({
    siteId: site.id,
    externalId: `bk-${diasAtras}`,
    startedAt: new Date(AGORA.getTime() - diasAtras * 24 * 3600_000),
    finishedAt: new Date(AGORA.getTime() - diasAtras * 24 * 3600_000 + 300_000),
    status: 'FINISHED',
  })
}

async function definir(over: { autoUpdate?: boolean; windows?: { start: string; end: string }[] }) {
  await db
    .update(schema.sites)
    .set({
      ...(over.autoUpdate !== undefined ? { autoUpdate: over.autoUpdate } : {}),
      ...(over.windows ? { maintenanceWindows: over.windows } : {}),
    })
    .where(eq(schema.sites.id, site.id))
}

function correr() {
  return runWpAutoUpdate({ db, umbrellaToken: 'tok', now: AGORA }, site, {})
}

async function registos() {
  return db.select().from(schema.wpUpdates).where(eq(schema.wpUpdates.siteId, site.id))
}

describe('condições para poder mexer', () => {
  it('não faz nada com a opção desligada, mesmo com tudo o resto em ordem', async () => {
    await ligar()
    await comComponentePorAtualizar()
    await comCopiaRecente()
    await definir({ autoUpdate: false, windows: JANELA_ABERTA })

    const outcome = await correr()

    expect(escritas).toEqual([])
    expect(outcome.metrics.ordered).toBe(0)
    expect(outcome.warnings.join(' ')).toContain('desligada')
  })

  it('não faz nada fora da janela de manutenção', async () => {
    await ligar()
    await comComponentePorAtualizar()
    await comCopiaRecente()
    await definir({ autoUpdate: true, windows: JANELA_FECHADA })

    const outcome = await correr()

    expect(escritas).toEqual([])
    expect(outcome.warnings.join(' ')).toContain('Fora da janela')
  })

  it('avisa quando está ligado e não há janela nenhuma', async () => {
    // Ligado e sem janela é a combinação que não faz nada e parece que faz.
    await ligar()
    await comComponentePorAtualizar()
    await comCopiaRecente()
    await definir({ autoUpdate: true, windows: [] })

    const outcome = await correr()

    expect(escritas).toEqual([])
    expect(outcome.findings[0]?.code).toBe('wp_auto_update_no_window')
  })

  it('recusa atualizar sem cópia de segurança concluída', async () => {
    // A reversão do fornecedor não cobre o caso em que o próprio mecanismo
    // de cópia está partido — que é exatamente quando isto importa.
    await ligar()
    await comComponentePorAtualizar()
    await definir({ autoUpdate: true, windows: JANELA_ABERTA })

    const outcome = await correr()

    expect(escritas).toEqual([])
    expect(outcome.findings[0]?.code).toBe('wp_auto_update_blocked')
    expect(outcome.findings[0]?.severity).toBe('high')
  })

  it('recusa atualizar com a cópia fora do prazo', async () => {
    await ligar()
    await comComponentePorAtualizar()
    await comCopiaRecente(BACKUP_REQUIRED_WITHIN_DAYS + 1)
    await definir({ autoUpdate: true, windows: JANELA_ABERTA })

    const outcome = await correr()

    expect(escritas).toEqual([])
    expect(outcome.findings[0]?.code).toBe('wp_auto_update_blocked')
  })
})

describe('quando pode mexer', () => {
  it('ordena a atualização e regista o que mandou, antes de saber o resultado', async () => {
    await ligar()
    await comComponentePorAtualizar()
    await comCopiaRecente()
    await definir({ autoUpdate: true, windows: JANELA_ABERTA })

    const outcome = await correr()

    expect(escritas).toHaveLength(1)
    expect(escritas[0]?.path).toBe('/projects/123/plugins/update')
    expect(escritas[0]?.body).toEqual({
      plugin_keys: ['contact-form-7/wp-contact-form-7.php'],
      update_type: 'SAFE_UPDATE',
    })
    expect(outcome.metrics.ordered).toBe(1)

    const linhas = await registos()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({
      kind: 'plugin',
      name: 'Contact Form 7',
      fromVersion: '5.7.0',
      toVersion: '5.9.0',
      processId: 'proc-1',
      status: 'pending',
    })
  })

  it('não empilha um lote novo enquanto o anterior não fechar', async () => {
    // Sem isto perde-se a correspondência entre o que se mandou e o que
    // aconteceu, que é a única coisa que este registo tem de garantir.
    await ligar()
    await comComponentePorAtualizar()
    await comCopiaRecente()
    await definir({ autoUpdate: true, windows: JANELA_ABERTA })

    await correr()
    escritas = []
    const segunda = await correr()

    expect(escritas).toEqual([])
    expect(segunda.warnings.join(' ')).toContain('por confirmar')
    expect(await registos()).toHaveLength(1)
  })

  it('não ordena nada quando não há atualizações por aplicar', async () => {
    await ligar()
    await comCopiaRecente()
    await definir({ autoUpdate: true, windows: JANELA_ABERTA })

    const outcome = await correr()

    expect(escritas).toEqual([])
    expect(outcome.metrics.ordered).toBe(0)
    expect(outcome.findings).toEqual([])
  })
})

describe('reconciliação', () => {
  it('fecha o que a ferramenta diz ter falhado', async () => {
    await ligar()
    await comComponentePorAtualizar()
    await comCopiaRecente()
    await definir({ autoUpdate: true, windows: JANELA_ABERTA })
    await correr()

    // Na execução seguinte a ferramenta já reporta o processo como falhado.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        escritas.push({ path: new URL(String(input)).pathname, body: null })
        return new Response(JSON.stringify({ code: 'success', data: { processId: 'x' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      const url = new URL(String(input))
      const corpo = url.pathname.endsWith('/processes')
        ? { code: 'success', data: [{ id: 'proc-1', type: 'UPDATE_PLUGIN', status: 'failed' }] }
        : { code: 'success', data: [] }
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof globalThis.fetch

    escritas = []
    const outcome = await correr()

    expect(outcome.metrics.reconciled).toBe(1)
    const linhas = await registos()
    expect(linhas[0]?.status).toBe('failed')
    expect(linhas[0]?.settledAt).not.toBeNull()
  })

  it('não conclui nada quando a leitura dos processos falha', async () => {
    await ligar()
    await comComponentePorAtualizar()
    await comCopiaRecente()
    await definir({ autoUpdate: true, windows: JANELA_ABERTA })
    await correr()

    globalThis.fetch = (async () => new Response('erro', { status: 500 })) as typeof globalThis.fetch

    const outcome = await correr()

    expect(outcome.metrics.reconciled).toBe(0)
    const linhas = await registos()
    expect(linhas[0]?.status).toBe('pending')
  })
})
