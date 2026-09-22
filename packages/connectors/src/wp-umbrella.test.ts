import { describe, expect, it } from 'vitest'
import exemplos from './fixtures/wp-umbrella-spec-examples.json' with { type: 'json' }
import { WpUmbrellaClient, WpUmbrellaError } from './wp-umbrella.js'

/**
 * Os exemplos vêm da especificação OpenAPI que a WP Umbrella publica, copiados
 * e não inventados. Um cliente testado contra fixtures da nossa cabeça só
 * prova que o nosso mapeamento é consistente consigo próprio.
 */
const EXEMPLOS = exemplos as Record<string, unknown>

function fakeFetch(porCaminho: Record<string, unknown>, registo: string[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    registo.push(url.pathname + url.search)

    const autorizacao = new Headers(init?.headers).get('authorization')
    if (autorizacao !== 'Bearer token-de-teste') {
      return new Response('{"message":"unauthorized"}', { status: 401 })
    }

    const corpo = porCaminho[url.pathname]
    if (corpo === undefined) return new Response('não encontrado', { status: 404 })

    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
}

function cliente(porCaminho: Record<string, unknown>, registo?: string[]) {
  return new WpUmbrellaClient({
    token: 'token-de-teste',
    baseUrl: 'https://api.exemplo',
    fetchImpl: fakeFetch(porCaminho, registo),
  })
}

describe('listProjects', () => {
  it('lê a frota do exemplo da especificação', async () => {
    const projetos = await cliente({ '/projects': EXEMPLOS['/projects'] }).listProjects()

    expect(projetos).toHaveLength(1)
    expect(projetos[0]).toMatchObject({
      id: 123,
      baseUrl: 'https://example.com',
      name: 'Example Website',
      connectivity: 'paired',
      isDisconnected: false,
      isCurrentlyDown: false,
      phpIssues: 2,
    })
  })
})

describe('listPlugins', () => {
  it('lê versão instalada e versão nova do exemplo da especificação', async () => {
    const plugins = await cliente({
      '/projects/1/plugins': EXEMPLOS['/projects/{projectId}/plugins'],
    }).listPlugins(1)

    expect(plugins).toHaveLength(2)
    expect(plugins[0]).toMatchObject({
      key: 'example-plugin/example-plugin.php',
      name: 'Example Plugin',
      version: '2.1.0',
      newVersion: '2.2.0',
      active: true,
    })
    // `need_update: {}` significa que está atualizado, não que falta informação.
    expect(plugins[1]).toMatchObject({ version: '1.5.0', newVersion: null, active: false })
  })
})

describe('listThemes', () => {
  it('deteta a atualização pelo latest_version, que é o que os temas usam', async () => {
    // Os temas não trazem `need_update` como os plugins. Mapeá-los da mesma
    // maneira dizia que nenhum tema tem atualizações, sempre.
    const temas = await cliente({
      '/projects/1/themes': EXEMPLOS['/projects/{projectId}/themes'],
    }).listThemes(1)

    expect(temas[0]).toMatchObject({
      name: 'Twenty Twenty-Four',
      version: '1.2.0',
      newVersion: '1.3.0',
      active: true,
    })
  })

  it('não inventa atualização quando a versão mais recente é a instalada', async () => {
    const temas = await cliente({
      '/projects/1/themes': {
        code: 'success',
        data: [{ id: 1, name: 'Tema', version: '1.0.0', latest_version: '1.0.0' }],
      },
    }).listThemes(1)

    expect(temas[0]?.newVersion).toBeNull()
  })
})

describe('listVulnerabilities', () => {
  it('junta plugins, temas e core numa lista só, com o CVSS', async () => {
    const { vulnerabilities: vulns } = await cliente({
      '/projects/1/vulnerabilities': EXEMPLOS['/projects/{projectId}/vulnerabilities'],
    }).listVulnerabilities(1)

    const plugin = vulns.find((v) => v.kind === 'plugin')
    expect(plugin).toMatchObject({
      component: 'contact-form-7',
      installedVersion: '5.7.0',
      title: 'Cross-Site Scripting (XSS)',
      cvssScore: 6.1,
      versionFixedIn: '5.7.1',
    })
    expect(plugin?.reference).toContain('patchstack.com')

    expect(vulns.find((v) => v.kind === 'theme')).toMatchObject({
      component: 'flavor',
      cvssScore: 9.8,
    })
  })

  it('traz a versão do core no mesmo pedido', async () => {
    // É o único sítio onde a API a dá fora de uma cópia de segurança. Ir
    // buscá-la a um segundo pedido era pedir duas vezes o mesmo a uma API
    // com limite de pedidos que ninguém documentou.
    const { core } = await cliente({
      '/projects/1/vulnerabilities': EXEMPLOS['/projects/{projectId}/vulnerabilities'],
    }).listVulnerabilities(1)

    expect(core).toEqual({ version: '6.4.0', latestVersion: '6.5.0' })
  })

  it('devolve lista vazia quando não há nada, em vez de rebentar', async () => {
    const relatorio = await cliente({
      '/projects/1/vulnerabilities': { code: 'success', data: {} },
    }).listVulnerabilities(1)

    expect(relatorio.vulnerabilities).toEqual([])
    // Nulo e não uma versão inventada: um site acabado de ligar ainda não foi
    // analisado, e isso é diferente de estar atualizado.
    expect(relatorio.core).toEqual({ version: null, latestVersion: null })
  })
})

describe('listBackups', () => {
  it('lê o estado de cada cópia, incluindo a que falhou', async () => {
    const backups = await new WpUmbrellaClient({
      token: 'token-de-teste',
      fetchImpl: fakeFetch({
        '/projects/1/backups': EXEMPLOS['/projects/{projectId}/backups'],
      }),
    }).listBackups(1)

    expect(backups).toHaveLength(2)
    expect(backups[0]).toMatchObject({
      externalId: 'clx1abc123',
      status: 'FINISHED',
      triggerType: 'AUTOMATIC',
      wordpressVersion: '6.7.1',
      sizeBytes: 524_288_000,
      errorCode: null,
    })
    // A que falhou não tem fim e traz o código do erro. É este o caso que
    // interessa vigiar: uma cópia que nunca terminou não é cópia nenhuma.
    expect(backups[1]).toMatchObject({
      status: 'ERROR',
      finishedAt: null,
      errorCode: 'TIMEOUT',
    })
  })

  it('pede uma página só, com o limite pedido', async () => {
    const registo: string[] = []
    await new WpUmbrellaClient({
      token: 'token-de-teste',
      fetchImpl: fakeFetch(
        { '/projects/7/backups': EXEMPLOS['/projects/{projectId}/backups'] },
        registo,
      ),
    }).listBackups(7, 5)

    expect(registo).toEqual(['/projects/7/backups?page=1&per_page=5'])
  })
})

describe('listIssues', () => {
  it('lê os erros e filtra por severidade quando pedido', async () => {
    const registo: string[] = []
    const erros = await new WpUmbrellaClient({
      token: 'token-de-teste',
      fetchImpl: fakeFetch(
        { '/projects/1/issues': EXEMPLOS['/projects/{projectId}/issues'] },
        registo,
      ),
    }).listIssues(1, { severity: 'FATAL', limit: 20 })

    expect(registo).toEqual(['/projects/1/issues?page=1&per_page=20&severity=FATAL'])
    expect(erros[0]).toMatchObject({
      severity: 'FATAL',
      sourceName: 'Contact Form 7',
      sourceSlug: 'contact-form-7',
      file: '/wp-content/plugins/contact-form-7/includes/mail.php',
      line: 214,
      occurrences: 37,
    })
  })
})

describe('ordenar atualizações', () => {
  function fakeWrite(registo: { path: string; body: unknown }[]) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      registo.push({
        path: url.pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return new Response(JSON.stringify({ code: 'success', data: { processId: 'p-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof globalThis.fetch
  }

  it('envia sempre o tipo de atualização segura, e não confia no default', async () => {
    // `update_type` é um parâmetro da API deles, não um comportamento
    // garantido. Deixá-lo de fora era entregar a um default que não
    // controlamos a decisão de haver ou não cópia e reversão.
    const registo: { path: string; body: unknown }[] = []
    const ref = await new WpUmbrellaClient({
      token: 'token-de-teste',
      fetchImpl: fakeWrite(registo),
    }).updatePlugins(9, ['wp-seopress/seopress.php'])

    expect(ref.processId).toBe('p-1')
    expect(registo).toEqual([
      {
        path: '/projects/9/plugins/update',
        body: {
          plugin_keys: ['wp-seopress/seopress.php'],
          update_type: 'SAFE_UPDATE',
        },
      },
    ])
  })

  it('aceita outro tipo quando lhe é pedido', async () => {
    const registo: { path: string; body: unknown }[] = []
    await new WpUmbrellaClient({
      token: 'token-de-teste',
      fetchImpl: fakeWrite(registo),
    }).updateThemes(9, ['astra'], 'ADVANCED_SAFE_UPDATE')

    expect(registo[0]).toEqual({
      path: '/projects/9/themes/update',
      body: { theme_keys: ['astra'], update_type: 'ADVANCED_SAFE_UPDATE' },
    })
  })

  it('recusa uma resposta sem identificador de processo', async () => {
    // Sem processo não há como saber se correu bem. Aceitar isto em silêncio
    // dava-nos uma atualização ordenada e um registo a dizer que correu.
    const semProcesso = (async () =>
      new Response(JSON.stringify({ code: 'success', data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof globalThis.fetch

    await expect(
      new WpUmbrellaClient({ token: 'token-de-teste', fetchImpl: semProcesso }).updatePlugins(
        1,
        ['x/x.php'],
      ),
    ).rejects.toBeInstanceOf(WpUmbrellaError)
  })

  it('lê o estado dos processos', async () => {
    const processos = await new WpUmbrellaClient({
      token: 'token-de-teste',
      fetchImpl: fakeFetch({
        '/projects/9/processes': {
          code: 'success',
          data: [
            {
              id: 'task123',
              type: 'UPDATE_PLUGIN',
              status: 'failed',
              created_at: '2026-09-22T01:00:00.000Z',
              entities: { name: 'Example Plugin', version: '2.0.0' },
            },
          ],
        },
      }),
    }).listProcesses(9)

    expect(processos[0]).toEqual({
      id: 'task123',
      type: 'UPDATE_PLUGIN',
      status: 'failed',
      createdAt: '2026-09-22T01:00:00.000Z',
      entityName: 'Example Plugin',
      entityVersion: '2.0.0',
    })
  })
})

describe('paginação', () => {
  it('segue as páginas até a última vir incompleta', async () => {
    // Um site com mais plugins do que o teto de uma página faria-nos dizer ao
    // cliente que tem menos do que tem — pior do que não dizer nada.
    const cheia = { code: 'success', data: Array.from({ length: 100 }, (_, i) => ({ key: `p${i}`, name: `P${i}`, version: '1.0' })) }
    const registo: string[] = []
    let chamadas = 0

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      registo.push(url.search)
      chamadas++
      const corpo = chamadas === 1 ? cheia : { code: 'success', data: [{ key: 'ultimo', name: 'Último', version: '1.0' }] }
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof globalThis.fetch

    const plugins = await new WpUmbrellaClient({
      token: 'token-de-teste',
      baseUrl: 'https://api.exemplo',
      fetchImpl,
    }).listPlugins(1)

    expect(plugins).toHaveLength(101)
    expect(registo).toEqual(['?page=1&per_page=100', '?page=2&per_page=100'])
  })
})

describe('erros', () => {
  it('diz o que fazer quando as credenciais são recusadas', async () => {
    const mau = new WpUmbrellaClient({
      token: 'errado',
      baseUrl: 'https://api.exemplo',
      fetchImpl: fakeFetch({ '/projects': EXEMPLOS['/projects'] }),
    })

    await expect(mau.listProjects()).rejects.toThrow(/scope `public_api`/)
  })

  it('nunca põe o token na mensagem de erro', async () => {
    // Já nos aconteceu uma password acabar nos logs do Fly dentro de uma
    // exceção, e o custo foi ter de a rodar.
    const segredo = 'token-super-secreto-123'
    const mau = new WpUmbrellaClient({
      token: segredo,
      baseUrl: 'https://api.exemplo',
      fetchImpl: (async () => new Response('ups', { status: 500 })) as typeof globalThis.fetch,
    })

    const erro = await mau.listProjects().catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(WpUmbrellaError)
    expect(String(erro)).not.toContain(segredo)
    expect(String(erro)).toContain('500')
  })

  it('distingue o limite de pedidos de um erro qualquer', async () => {
    const limitado = new WpUmbrellaClient({
      token: 't',
      baseUrl: 'https://api.exemplo',
      fetchImpl: (async () => new Response('', { status: 429 })) as typeof globalThis.fetch,
    })

    const erro = (await limitado.listProjects().catch((e: unknown) => e)) as WpUmbrellaError
    expect(erro.status).toBe(429)
    expect(erro.message).toContain('limite de pedidos')
  })
})
