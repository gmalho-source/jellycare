import type { Site } from '@jellycare/core'
import { createDatabase, schema } from '@jellycare/db'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { and, eq } from 'drizzle-orm'
import type { Browser } from 'playwright'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBrowserPool } from './browser-pool.js'
import { runFormDelivery, runFormDiscovery, runFormTest } from './form-jobs.js'

/**
 * Rotinas de formulários contra Postgres e browser reais.
 *
 * O que se verifica aqui é o inventário e o ciclo de vida: que a descoberta
 * guarda o que encontra sem reativar o que alguém desligou, que a submissão
 * relê e reclassifica antes de submeter, e que a avaliação de entrega só abre
 * problema depois de dar tempo ao email para chegar.
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 4 })

const CONTACT_FORM = `
  <form id="contacto" method="post" action="/enviar">
    <input name="nome" required>
    <input name="email" type="email" required>
    <textarea name="mensagem" required></textarea>
    <button type="submit">Enviar</button>
  </form>`

const LOGIN_FORM = `
  <form id="contacto" method="post">
    <input name="email" type="email">
    <input name="password" type="password">
    <button type="submit">Entrar</button>
  </form>`

/** Conteúdo servido em /contactos, trocável a meio de um teste. */
let contactPage = CONTACT_FORM
let submissions = 0
let formBreaks = false

let server: Server
let baseUrl: string
let organizationId: string
let site: Site
const pool = createBrowserPool(
  existsSync('/opt/pw-browsers/chromium')
    ? { executablePath: '/opt/pw-browsers/chromium', noSandbox: true }
    : { noSandbox: true },
)

await new Promise<void>((resolve) => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] as string

    if (req.method === 'POST' && path === '/enviar') {
      req.resume()
      req.on('end', () => {
        submissions++
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body><h1>Obrigado</h1><p>Mensagem enviada com sucesso.</p></body></html>')
      })
      return
    }

    if (path === '/robots.txt') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('')
      return
    }

    if (path === '/contactos') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><html><body>${contactPage}${
          formBreaks
            ? `<script>document.getElementById('contacto').addEventListener('submit',e=>{e.preventDefault();const d=document.createElement('div');d.className='wpcf7-not-valid-tip';d.textContent='Erro ao enviar.';document.body.appendChild(d)})</script>`
            : ''
        }</body></html>`,
      )
      return
    }

    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><body><a href="/contactos">Contactos</a></body></html>')
      return
    }

    res.writeHead(404, { 'content-type': 'text/html' })
    res.end('<html><body>404</body></html>')
  })

  server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    resolve()
  })
})

beforeEach(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Cliente', slug: `formulario-${Date.now()}-${Math.random()}` })
    .returning({ id: schema.organizations.id })
  organizationId = org!.id

  // A página de contactos vai declarada: desde que o teste de formulários
  // deixou de ser decidido pela heurística, um site sem páginas declaradas
  // não submete nada, e é isso que os testes de declaração abaixo verificam.
  const [row] = await db
    .insert(schema.sites)
    .values({
      organizationId,
      label: 'Site do cliente',
      url: baseUrl,
      hostname: '127.0.0.1',
      state: 'active',
      formTestUrls: [`${baseUrl}/contactos`],
    })
    .returning({ id: schema.sites.id })

  site = {
    id: row!.id,
    organizationId,
    url: baseUrl,
    hostname: '127.0.0.1',
    label: 'Site do cliente',
  }

  contactPage = CONTACT_FORM
  formBreaks = false
  submissions = 0
})

afterAll(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  await pool.close()
  await close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const deps = () => ({ db, browser: pool.get })

async function storedForms() {
  return db.select().from(schema.forms).where(eq(schema.forms.siteId, site.id))
}

async function formRuns() {
  return db.select().from(schema.formRuns).where(eq(schema.formRuns.siteId, site.id))
}

describe('runFormDiscovery', () => {
  it('encontra o formulário de contacto e guarda-o pronto a testar', async () => {
    const outcome = await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    expect(outcome.status).toBe('ok')
    expect(outcome.metrics.contactForms).toBe(1)

    const forms = await storedForms()
    expect(forms).toHaveLength(1)
    expect(forms[0]).toMatchObject({ selector: '#contacto', enabled: true, excluded: false })
    // O mapa de campos alimenta o painel e a configuração manual.
    expect(forms[0]?.fieldMap).toMatchObject({ email: 'email', mensagem: 'message' })
  }, 60_000)

  it('dá ao formulário um rótulo que se lê, e não um seletor CSS', async () => {
    // O que o cliente vê no painel e no relatório. `form:nth-of-type(1)` não
    // significa nada para ninguém fora do código — e era o que sobrava em
    // qualquer formulário sem id nem botão declarado.
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const [form] = await storedForms()
    expect(form?.label).toBe('Formulário de contacto · /contactos')
    expect(form?.label).not.toContain('nth-of-type')
  }, 60_000)

  it('correr duas vezes não duplica o inventário', async () => {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    expect(await storedForms()).toHaveLength(1)
  }, 60_000)

  it('não reativa um formulário que alguém desligou', async () => {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    const [form] = await storedForms()
    await db.update(schema.forms).set({ enabled: false }).where(eq(schema.forms.id, form!.id))

    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const [after] = await storedForms()
    expect(after?.enabled).toBe(false)
  }, 60_000)

  it('exclui imediatamente um formulário que passou a ser de autenticação', async () => {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    contactPage = LOGIN_FORM

    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const [after] = await storedForms()
    expect(after?.excluded).toBe(true)
  }, 60_000)

  it('reporta o desaparecimento de um formulário de contacto', async () => {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    contactPage = '<p>Contacte-nos por telefone.</p>'

    const outcome = await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const finding = outcome.findings.find((f) => f.code === 'contact_form_disappeared')
    expect(finding?.severity).toBe('high')
  }, 60_000)

  it('não reporta desaparecimento quando a página nem chegou a ser analisada', async () => {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    // Orçamento que não chega para lá da homepage: não é o mesmo que o
    // formulário ter desaparecido.
    const outcome = await runFormDiscovery(deps(), site, { crawlDelayMs: 0, maxPages: 1 })

    expect(outcome.findings).toEqual([])
  }, 60_000)
})

describe('runFormTest', () => {
  async function discoverThenTest() {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    return runFormTest(deps(), site, { canaryDomain: 'check.jellycare.pt' })
  }

  it('submete o formulário e regista a execução', async () => {
    const outcome = await discoverThenTest()

    expect(outcome.metrics.formsTested).toBe(1)
    expect(outcome.findings).toEqual([])
    expect(submissions).toBe(1)

    const runs = await formRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]?.submitted).toBe(true)
    expect(runs[0]?.canaryAddress).toContain('@check.jellycare.pt')
    expect(runs[0]?.emailReceived).toBe(false)
  }, 90_000)

  it('deteta o formulário que aceita o clique mas não envia', async () => {
    formBreaks = true
    const outcome = await discoverThenTest()

    const finding = outcome.findings.find((f) => f.code === 'form_submission_failed')
    expect(finding?.severity).toBe('high')
    expect(submissions).toBe(0)

    const runs = await formRuns()
    expect(runs[0]?.submitted).toBe(false)
    expect(runs[0]?.submitError).toBeTruthy()
  }, 90_000)

  it('não submete um formulário que entretanto passou a ser de login', async () => {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    contactPage = LOGIN_FORM

    const outcome = await runFormTest(deps(), site, { canaryDomain: 'check.jellycare.pt' })

    // A releitura antes de submeter é o que impede preencher um formulário de
    // autenticação por causa de um retrato antigo.
    expect(submissions).toBe(0)
    expect(outcome.metrics.formsTested).toBe(0)
    expect((await storedForms())[0]?.excluded).toBe(true)
    expect(await formRuns()).toHaveLength(0)
  }, 90_000)

  it('reporta o desaparecimento do formulário à hora do teste', async () => {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    contactPage = '<p>Sem formulário.</p>'

    const outcome = await runFormTest(deps(), site, { canaryDomain: 'check.jellycare.pt' })

    expect(outcome.findings[0]?.code).toBe('contact_form_disappeared')
    expect(submissions).toBe(0)
  }, 90_000)

  it('não faz nada quando não há formulários a testar', async () => {
    const outcome = await runFormTest(deps(), site, { canaryDomain: 'check.jellycare.pt' })

    expect(outcome.metrics.formsTested).toBe(0)
    expect(outcome.findings).toEqual([])
  }, 60_000)

  it('exige o domínio da caixa de verificação', async () => {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    await expect(runFormTest({ db }, site, {})).rejects.toThrow(/CANARY_EMAIL_DOMAIN|browser/)
  }, 60_000)
})

describe('runFormDelivery', () => {
  async function submissionAt(startedAt: Date, overrides: Record<string, unknown> = {}) {
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    const [form] = await storedForms()
    await db.insert(schema.formRuns).values({
      formId: form!.id,
      siteId: site.id,
      canaryToken: `tok-${Math.random().toString(36).slice(2)}`,
      canaryAddress: 'check+x@check.jellycare.pt',
      startedAt,
      submitted: true,
      ...overrides,
    })
    return form!
  }

  it('dá tempo ao email antes de reclamar', async () => {
    await submissionAt(new Date())

    const outcome = await runFormDelivery(deps(), site, { graceMinutes: 15 })

    // Uma submissão feita agora ainda não diz nada sobre a entrega.
    expect(outcome.metrics.runsEvaluated).toBe(0)
    expect(outcome.findings).toEqual([])
  }, 60_000)

  it('não chama avaria a uma entrega que nunca foi observável', async () => {
    // A maioria dos formulários notifica o dono do site e não responde a quem
    // submeteu — e o endereço canário é o de quem submeteu. Chamar avaria a
    // isto fazia disparar o alerta mais alarmante do produto em quase todos os
    // clientes no primeiro dia.
    await submissionAt(new Date(Date.now() - 30 * 60_000))

    const outcome = await runFormDelivery(deps(), site, { graceMinutes: 15 })

    const finding = outcome.findings.find((f) => f.code === 'form_delivery_unverified')
    expect(finding?.severity).toBe('low')
    expect(outcome.findings.some((f) => f.code === 'form_email_not_delivered')).toBe(false)
    // Não conta como entrega em falta: não houve entrega a faltar, houve
    // ausência de forma de a verificar.
    expect(outcome.metrics.missingDeliveries).toBe(0)
  }, 60_000)

  it('reporta como avaria a entrega que existia e deixou de existir', async () => {
    // Este é o incidente verdadeiro: o formulário já entregou antes, portanto
    // sabemos que a entrega é observável, e desta vez não chegou nada.
    await submissionAt(new Date(Date.now() - 90 * 60_000), {
      emailReceived: true,
      emailReceivedAt: new Date(Date.now() - 89 * 60_000),
    })
    await submissionAt(new Date(Date.now() - 30 * 60_000))

    const outcome = await runFormDelivery(deps(), site, { graceMinutes: 15 })

    const finding = outcome.findings.find((f) => f.code === 'form_email_not_delivered')
    expect(finding?.severity).toBe('high')
    expect(outcome.metrics.missingDeliveries).toBe(1)
  }, 60_000)

  it('não reclama de uma submissão que já tinha falhado', async () => {
    // O teste de formulários já reportou o problema; dizer duas vezes é ruído.
    await submissionAt(new Date(Date.now() - 30 * 60_000), { submitted: false })

    const outcome = await runFormDelivery(deps(), site, { graceMinutes: 15 })
    expect(outcome.findings).toEqual([])
  }, 60_000)

  it('aceita a entrega bem autenticada sem reportar nada', async () => {
    await submissionAt(new Date(Date.now() - 30 * 60_000), {
      emailReceived: true,
      emailReceivedAt: new Date(Date.now() - 29 * 60_000),
      deliveryLatencyMs: 12_000,
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
      landedInSpam: false,
    })

    const outcome = await runFormDelivery(deps(), site, { graceMinutes: 15 })
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.runsEvaluated).toBe(1)
  }, 60_000)

  it('trata a entrega no spam como problema grave', async () => {
    await submissionAt(new Date(Date.now() - 30 * 60_000), {
      emailReceived: true,
      deliveryLatencyMs: 8_000,
      spf: 'fail',
      landedInSpam: true,
    })

    const outcome = await runFormDelivery(deps(), site, { graceMinutes: 15 })
    const finding = outcome.findings.find((f) => f.code === 'form_email_in_spam')
    expect(finding?.severity).toBe('high')
  }, 60_000)

  it('assinala falhas de autenticação como risco, não como falha de entrega', async () => {
    await submissionAt(new Date(Date.now() - 30 * 60_000), {
      emailReceived: true,
      deliveryLatencyMs: 8_000,
      spf: 'fail',
      dkim: 'pass',
      dmarc: 'pass',
      landedInSpam: false,
    })

    const outcome = await runFormDelivery(deps(), site, { graceMinutes: 15 })
    const finding = outcome.findings.find((f) => f.code === 'form_email_auth_risk')
    expect(finding?.severity).toBe('medium')
  }, 60_000)

  it('assinala a notificação lenta', async () => {
    await submissionAt(new Date(Date.now() - 30 * 60_000), {
      emailReceived: true,
      deliveryLatencyMs: 11 * 60_000,
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
      landedInSpam: false,
    })

    const outcome = await runFormDelivery(deps(), site, {
      graceMinutes: 15,
      slowThresholdMs: 5 * 60_000,
    })

    const finding = outcome.findings.find((f) => f.code === 'form_email_slow')
    expect(finding?.severity).toBe('low')
  }, 60_000)

  it('avalia apenas a submissão mais recente já fora do período de graça', async () => {
    const form = await submissionAt(new Date(Date.now() - 3 * 60 * 60_000))
    await db.insert(schema.formRuns).values({
      formId: form.id,
      siteId: site.id,
      canaryToken: `tok-${Math.random().toString(36).slice(2)}`,
      canaryAddress: 'check+y@check.jellycare.pt',
      startedAt: new Date(Date.now() - 30 * 60_000),
      submitted: true,
      emailReceived: true,
      deliveryLatencyMs: 5_000,
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
      landedInSpam: false,
    })

    const outcome = await runFormDelivery(deps(), site, { graceMinutes: 15 })

    // A mais recente correu bem: o problema antigo já não é problema.
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.runsEvaluated).toBe(1)
  }, 60_000)

  it('ignora formulários desativados', async () => {
    const form = await submissionAt(new Date(Date.now() - 30 * 60_000))
    await db.update(schema.forms).set({ enabled: false }).where(eq(schema.forms.id, form.id))

    const outcome = await runFormDelivery(deps(), site, { graceMinutes: 15 })
    expect(outcome.findings).toEqual([])
  }, 60_000)
})

describe('inventário visível no painel', () => {
  it('guarda também os formulários que nunca serão submetidos', async () => {
    contactPage = `${CONTACT_FORM}
      <form class="newsletter" method="post"><input name="email" type="email"></form>`

    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const forms = await db
      .select()
      .from(schema.forms)
      .where(and(eq(schema.forms.siteId, site.id), eq(schema.forms.excluded, true)))

    expect(forms).toHaveLength(1)
  }, 60_000)
})

describe('só se testa onde o administrador mandou', () => {
  async function declarar(...urls: string[]) {
    await db
      .update(schema.sites)
      .set({ formTestUrls: urls })
      .where(eq(schema.sites.id, site.id))
  }

  it('sem páginas declaradas não submete nada, e diz porquê', async () => {
    // O caso que motivou tudo isto: não queremos escrever no site de ninguém
    // por iniciativa de uma heurística. Sem declaração, não se toca.
    await declarar()
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const outcome = await runFormTest(deps(), site, {
      canaryDomain: 'check.jellycare.pt',
    })

    expect(outcome.metrics.formsTested).toBe(0)
    expect(submissions).toBe(0)
    expect(outcome.warnings?.[0]).toContain('Nenhuma página de formulário declarada')
  }, 60_000)

  it('não testa um formulário que está fora das páginas declaradas', async () => {
    await declarar(`${baseUrl}/outra-pagina`)
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const outcome = await runFormTest(deps(), site, {
      canaryDomain: 'check.jellycare.pt',
    })

    expect(outcome.metrics.formsTested).toBe(0)
    expect(submissions).toBe(0)
  }, 60_000)

  it('a descoberta não ativa um formulário de uma página não declarada', async () => {
    await declarar(`${baseUrl}/outra-pagina`)
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const contacto = (await storedForms()).find((form) => form.pageUrl.includes('/contactos'))
    expect(contacto).toBeDefined()
    // Está no inventário — o cliente tem de o ver — mas não em teste.
    expect(contacto?.enabled).toBe(false)
    expect(contacto?.excluded).toBe(false)
  }, 60_000)

  it('desativa um formulário que ficou ativo antes de haver declaração', async () => {
    // Migração do comportamento antigo: o que a heurística deixou ligado tem
    // de se desligar sozinho, senão continuava a ser submetido para sempre.
    await declarar(`${baseUrl}/contactos`)
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })
    expect((await storedForms()).some((form) => form.enabled)).toBe(true)

    await declarar(`${baseUrl}/outra-pagina`)
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    expect((await storedForms()).some((form) => form.enabled)).toBe(false)
  }, 60_000)

  it('testa o formulário quando a página está declarada', async () => {
    await declarar(`${baseUrl}/contactos`)
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const outcome = await runFormTest(deps(), site, {
      canaryDomain: 'check.jellycare.pt',
    })

    expect(outcome.metrics.formsTested).toBe(1)
    expect(submissions).toBe(1)
  }, 60_000)

  it('uma barra final na declaração não impede o teste', async () => {
    // Parece detalhe e não é: um teste que não corresse por causa disto era
    // indistinguível de um teste desligado.
    await declarar(`${baseUrl}/contactos/`)
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const outcome = await runFormTest(deps(), site, {
      canaryDomain: 'check.jellycare.pt',
    })

    expect(outcome.metrics.formsTested).toBe(1)
  }, 60_000)

  it('reporta a página declarada que foi analisada e não tem formulário', async () => {
    // A homepage do servidor de teste só tem um link, sem formulário nenhum.
    await declarar(`${baseUrl}/`)
    const outcome = await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const finding = outcome.findings.find((f) => f.code === 'declared_form_page_empty')
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('medium')
  }, 60_000)

  it('reporta a página declarada que não existe', async () => {
    await declarar(`${baseUrl}/pagina-que-nao-existe`)
    const outcome = await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const finding = outcome.findings.find((f) => f.code === 'declared_form_page_unreachable')
    expect(finding).toBeDefined()
  }, 60_000)

  it('nunca submete um formulário de login, mesmo numa página declarada', async () => {
    // Declarar restringe onde mexemos; não autoriza mexer em tudo.
    await declarar(`${baseUrl}/contactos`)
    contactPage = LOGIN_FORM
    await runFormDiscovery(deps(), site, { crawlDelayMs: 0 })

    const outcome = await runFormTest(deps(), site, {
      canaryDomain: 'check.jellycare.pt',
    })

    expect(outcome.metrics.formsTested).toBe(0)
    expect(submissions).toBe(0)
  }, 60_000)
})
