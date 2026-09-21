import { createDatabase, schema } from '@jellycare/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Site } from '@jellycare/core'
import { runWpInventory } from './wp-jobs.js'

/**
 * Inventário WordPress pela API da WP Umbrella, contra Postgres real e uma
 * API falsa que devolve as formas da especificação deles.
 *
 * As asserções são todas âmbito deste site. O turbo corre os pacotes em
 * paralelo contra a mesma base de dados de teste, e qualquer contagem global
 * falha de forma intermitente — já nos custou dias uma vez.
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

let organizationId: string
let site: Site

beforeEach(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Cliente WP', slug: `wp-${Date.now()}-${Math.random()}` })
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

async function ligar(externalId = '123') {
  await db.insert(schema.connectors).values({
    siteId: site.id,
    type: 'wp_umbrella',
    externalId,
    externalName: 'Example Website',
  })
}

function apiFalsa(porCaminho: Record<string, unknown>) {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const corpo = porCaminho[url.pathname] ?? { code: 'success', data: [] }
    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
}

const PLUGINS = {
  code: 'success',
  data: [
    {
      key: 'contact-form-7/wp-contact-form-7.php',
      name: 'Contact Form 7',
      version: '5.7.0',
      is_active: true,
      need_update: { new_version: '5.9.0' },
    },
    { key: 'akismet/akismet.php', name: 'Akismet', version: '5.3', is_active: true, need_update: {} },
  ],
}

const TEMAS = {
  code: 'success',
  data: [{ id: 1, name: 'Astra', version: '4.0.0', latest_version: '4.1.0', is_active: true }],
}

const VULNS = {
  code: 'success',
  data: {
    plugin_vulnerabilities: [
      {
        plugin: { id: 1, name: 'contact-form-7', version: '5.7.0' },
        vulnerabilities: [
          {
            title: 'Cross-Site Scripting (XSS)',
            cvss_score: 6.1,
            version_fixed_in: '5.7.1',
            disclosure_date: '2024-01-15',
            patchstack_url: 'https://patchstack.com/database/vulnerability/12345',
          },
          {
            title: 'Remote Code Execution',
            cvss_score: 9.8,
            version_fixed_in: '5.8.0',
            patchstack_url: 'https://patchstack.com/database/vulnerability/99999',
          },
        ],
      },
    ],
  },
}

function deps(porCaminho: Record<string, unknown>) {
  return {
    db,
    umbrellaToken: 'token',
    umbrellaBaseUrl: 'https://api.exemplo',
    fetch: apiFalsa(porCaminho),
  }
}

const CAMINHOS = {
  '/projects/123/plugins': PLUGINS,
  '/projects/123/themes': TEMAS,
  '/projects/123/vulnerabilities': VULNS,
}

describe('site sem ligação', () => {
  it('não é erro, é configuração por fazer', async () => {
    // A maioria dos sites não é WordPress. Tratar isto como avaria enchia o
    // painel de vermelho por uma coisa que não está errada.
    const outcome = await runWpInventory(deps({}), site, {})

    expect(outcome.status).toBe('ok')
    expect(outcome.findings).toEqual([])
    expect(outcome.warnings?.[0]).toContain('não está ligado')
  })
})

describe('inventário', () => {
  it('guarda plugins e temas, com a versão nova quando existe', async () => {
    await ligar()
    const outcome = await runWpInventory(deps(CAMINHOS), site, {})

    expect(outcome.metrics).toMatchObject({ plugins: 2, themes: 1, updatesPending: 2 })

    const componentes = await db
      .select()
      .from(schema.wpComponents)
      .where(eq(schema.wpComponents.siteId, site.id))

    const cf7 = componentes.find((c) => c.key.startsWith('contact-form-7'))
    expect(cf7).toMatchObject({ kind: 'plugin', version: '5.7.0', latestVersion: '5.9.0' })

    const akismet = componentes.find((c) => c.key.startsWith('akismet'))
    expect(akismet?.latestVersion).toBeNull()

    expect(componentes.find((c) => c.kind === 'theme')).toMatchObject({
      name: 'Astra',
      latestVersion: '4.1.0',
    })
  })

  it('apaga o que deixou de estar instalado', async () => {
    // Um plugin removido que ficasse no inventário mostrava ao cliente uma
    // coisa que já não tem — e podia manter viva a vulnerabilidade dele.
    await ligar()
    await runWpInventory(deps(CAMINHOS), site, {})

    const semAkismet = {
      ...CAMINHOS,
      '/projects/123/plugins': { code: 'success', data: [PLUGINS.data[0]] },
    }
    await runWpInventory(deps(semAkismet), site, {})

    const componentes = await db
      .select()
      .from(schema.wpComponents)
      .where(eq(schema.wpComponents.siteId, site.id))

    expect(componentes.some((c) => c.key.startsWith('akismet'))).toBe(false)
    expect(componentes.some((c) => c.key.startsWith('contact-form-7'))).toBe(true)
  })

  it('marca a sincronização e limpa o erro anterior', async () => {
    await ligar()
    await db
      .update(schema.connectors)
      .set({ lastError: 'falha antiga' })
      .where(eq(schema.connectors.siteId, site.id))

    await runWpInventory(deps(CAMINHOS), site, {})

    const [ligacao] = await db
      .select()
      .from(schema.connectors)
      .where(eq(schema.connectors.siteId, site.id))

    expect(ligacao?.lastSyncAt).not.toBeNull()
    expect(ligacao?.lastError).toBeNull()
  })
})

describe('vulnerabilidades', () => {
  it('gera um finding por vulnerabilidade, com a severidade do CVSS', async () => {
    // Uma a uma e não agregadas: um crítico não pode desaparecer dentro de
    // uma contagem.
    await ligar()
    const outcome = await runWpInventory(deps(CAMINHOS), site, {})

    const vulns = outcome.findings.filter((f) => f.code === 'wp_known_vulnerability')
    expect(vulns).toHaveLength(2)

    const critico = vulns.find((f) => f.title.includes('contact-form-7') && f.severity === 'critical')
    expect(critico?.detail).toContain('Remote Code Execution')
    expect(critico?.detail).toContain('5.8.0')

    expect(vulns.some((f) => f.severity === 'medium')).toBe(true)
  })

  it('inclui a versão instalada no discriminador', async () => {
    // Atualizar para uma versão que continua vulnerável é um problema novo,
    // e não o mesmo problema a persistir.
    await ligar()
    const outcome = await runWpInventory(deps(CAMINHOS), site, {})

    const vuln = outcome.findings.find((f) => f.code === 'wp_known_vulnerability')
    expect(vuln?.discriminator).toContain('5.7.0')
  })
})

describe('atualizações pendentes', () => {
  it('agrega num único finding e nomeia o que está por atualizar', async () => {
    // Vinte alertas "há update" ensinam o cliente a ignorar alertas.
    await ligar()
    const outcome = await runWpInventory(deps(CAMINHOS), site, {})

    const updates = outcome.findings.filter((f) => f.code === 'wp_updates_pending')
    expect(updates).toHaveLength(1)
    expect(updates[0]?.severity).toBe('medium')
    expect(updates[0]?.title).toContain('2')
    expect(updates[0]?.detail).toContain('Contact Form 7 5.7.0 → 5.9.0')
  })

  it('não reporta nada quando está tudo atualizado', async () => {
    await ligar()
    const outcome = await runWpInventory(
      deps({
        '/projects/123/plugins': { code: 'success', data: [PLUGINS.data[1]] },
        '/projects/123/themes': { code: 'success', data: [] },
        '/projects/123/vulnerabilities': { code: 'success', data: {} },
      }),
      site,
      {},
    )

    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.updatesPending).toBe(0)
  })
})

describe('falhas da API', () => {
  it('um 429 não marca a execução como falhada', async () => {
    // Limite de pedidos não é avaria nossa nem do cliente: é ritmo.
    await ligar()
    const outcome = await runWpInventory(
      {
        db,
        umbrellaToken: 'token',
        umbrellaBaseUrl: 'https://api.exemplo',
        fetch: (async () => new Response('', { status: 429 })) as typeof globalThis.fetch,
      },
      site,
      {},
    )

    expect(outcome.status).toBe('ok')
    expect(outcome.warnings?.[0]).toContain('limite de pedidos')
  })

  it('guarda o erro na ligação para o painel o mostrar', async () => {
    await ligar()
    await runWpInventory(
      {
        db,
        umbrellaToken: 'token',
        umbrellaBaseUrl: 'https://api.exemplo',
        fetch: (async () => new Response('', { status: 401 })) as typeof globalThis.fetch,
      },
      site,
      {},
    ).catch(() => undefined)

    const [ligacao] = await db
      .select()
      .from(schema.connectors)
      .where(eq(schema.connectors.siteId, site.id))

    expect(ligacao?.lastError).toContain('credenciais')
  })

  it('não apaga o inventário anterior quando a API falha', async () => {
    // Um inventário que desaparecesse a cada falha de rede fazia o painel
    // dizer ao cliente que não tem plugins nenhuns.
    await ligar()
    await runWpInventory(deps(CAMINHOS), site, {})

    await runWpInventory(
      {
        db,
        umbrellaToken: 'token',
        umbrellaBaseUrl: 'https://api.exemplo',
        fetch: (async () => new Response('', { status: 500 })) as typeof globalThis.fetch,
      },
      site,
      {},
    ).catch(() => undefined)

    const componentes = await db
      .select()
      .from(schema.wpComponents)
      .where(eq(schema.wpComponents.siteId, site.id))

    expect(componentes.length).toBeGreaterThan(0)
  })
})
