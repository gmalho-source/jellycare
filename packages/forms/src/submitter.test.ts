import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchBrowser } from './browser.js'
import { buildCanaryIdentity, buildFillPlan } from './canary.js'
import { discoverForms, type DiscoveredForm } from './discovery.js'
import { FormNotTestableError, submitForm } from './submitter.js'

/**
 * Integração real: browser verdadeiro contra um servidor verdadeiro.
 *
 * O valor do teste de formulários está inteiro aqui. Um teste com DOM
 * simulado validaria os seletores mas não o que interessa: que o preenchimento
 * e a submissão funcionam num browser, incluindo validação HTML5, JavaScript
 * do formulário e a leitura da resposta.
 */

const canary = buildCanaryIdentity({
  siteId: 'site1',
  domain: 'check.jellycare.pt',
  tokenGenerator: () => 'abc12345',
})

/** Submissões recebidas pelo servidor de teste, para verificar o que chegou. */
const received: Record<string, string>[] = []

const FORMS: Record<string, string> = {
  '/classico': `<!doctype html><html><body>
    <form id="contacto" method="post" action="/enviar">
      <label for="nome">Nome</label><input id="nome" name="nome" required>
      <label for="email">Email</label><input id="email" name="email" type="email" required>
      <label for="tel">Telefone</label><input id="tel" name="telefone" type="tel">
      <label for="msg">Mensagem</label><textarea id="msg" name="mensagem" required></textarea>
      <label><input type="checkbox" name="rgpd" required> Aceito a política de privacidade</label>
      <button type="submit">Enviar</button>
    </form>
  </body></html>`,

  '/ajax': `<!doctype html><html><body>
    <form id="contacto" method="post">
      <input name="email" type="email" required>
      <textarea name="mensagem" required></textarea>
      <button type="submit">Enviar</button>
    </form>
    <div id="resposta" style="display:none">Obrigado! A sua mensagem foi enviada.</div>
    <script>
      document.getElementById('contacto').addEventListener('submit', async (event) => {
        event.preventDefault()
        await fetch('/enviar', { method: 'POST', body: new FormData(event.target) })
        document.getElementById('contacto').style.display = 'none'
        document.getElementById('resposta').style.display = 'block'
      })
    </script>
  </body></html>`,

  '/avariado': `<!doctype html><html><body>
    <form id="contacto" method="post">
      <input name="email" type="email" required>
      <textarea name="mensagem" required></textarea>
      <button type="submit">Enviar</button>
    </form>
    <script>
      document.getElementById('contacto').addEventListener('submit', (event) => {
        event.preventDefault()
        const erro = document.createElement('div')
        erro.className = 'wpcf7-not-valid-tip'
        erro.textContent = 'Ocorreu um erro ao enviar a sua mensagem. Tente mais tarde.'
        document.body.appendChild(erro)
      })
    </script>
  </body></html>`,

  '/select': `<!doctype html><html><body>
    <form id="contacto" method="post" action="/enviar">
      <input name="email" type="email" required>
      <textarea name="mensagem" required></textarea>
      <select name="assunto" required>
        <option value="">Escolha um assunto</option>
        <option value="orcamento">Orçamento</option>
        <option value="suporte">Suporte</option>
      </select>
      <button type="submit">Enviar</button>
    </form>
  </body></html>`,

  '/login': `<!doctype html><html><body>
    <form id="entrar" method="post" action="/autenticar">
      <input name="email" type="email">
      <input name="password" type="password">
      <button type="submit">Entrar</button>
    </form>
  </body></html>`,
}

let server: Server
let baseUrl: string
let browser: Browser

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] as string

    if (req.method === 'POST' && path === '/enviar') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        // Aceita tanto urlencoded como multipart, guardando o que der para ler.
        const fields: Record<string, string> = {}
        if (body.includes('Content-Disposition')) {
          for (const match of body.matchAll(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n--/g)) {
            fields[match[1] as string] = (match[2] as string).trim()
          }
        } else {
          for (const [key, value] of new URLSearchParams(body)) fields[key] = value
        }
        received.push(fields)
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<!doctype html><html><body><h1>Obrigado</h1><p>Mensagem enviada com sucesso.</p></body></html>')
      })
      return
    }

    const page = FORMS[path]
    if (!page) {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end('<html><body>404</body></html>')
      return
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  // Imagens que já trazem o Chromium instalado (este container, CI) apontam
  // para o binário; fora delas, deixa-se o Playwright resolver sozinho.
  const preinstalled = '/opt/pw-browsers/chromium'
  const executablePath =
    process.env.JELLYCARE_CHROMIUM_PATH ?? (existsSync(preinstalled) ? preinstalled : undefined)

  browser = await launchBrowser({
    ...(executablePath ? { executablePath } : {}),
    noSandbox: true,
  })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function formAt(path: string): Promise<{ form: DiscoveredForm; url: string }> {
  const url = `${baseUrl}${path}`
  const html = await fetch(url).then((response) => response.text())
  const forms = discoverForms(html, url)
  return { form: forms[0]!, url }
}

async function submit(path: string, successIndicator?: string) {
  const { form, url } = await formAt(path)
  const plan = buildFillPlan(form, canary)
  return submitForm({
    browser,
    pageUrl: url,
    form,
    plan,
    timeoutMs: 20_000,
    ...(successIndicator ? { successIndicator } : {}),
  })
}

describe('submitForm', () => {
  it('preenche e submete um formulário clássico, com os valores corretos', async () => {
    received.length = 0
    const result = await submit('/classico')

    expect(result.submitted).toBe(true)
    expect(result.validationErrors).toEqual([])

    const submission = received[0]
    expect(submission?.email).toBe('check+site1-abc12345@check.jellycare.pt')
    expect(submission?.nome).toBe('Jellycare Monitor')
    expect(submission?.telefone).toBe('+351200000000')
    // A referência tem de chegar ao destinatário, senão não é possível casar o
    // email recebido com esta submissão.
    expect(submission?.mensagem).toContain('abc12345')
    // Sem marcar a checkbox obrigatória, a validação HTML5 bloqueava tudo.
    expect(submission?.rgpd).toBeDefined()
  }, 60_000)

  it('deteta sucesso num formulário que responde por JavaScript', async () => {
    received.length = 0
    const result = await submit('/ajax')

    expect(result.submitted).toBe(true)
    expect(received).toHaveLength(1)
  }, 60_000)

  it('deteta o formulário que aceita o clique mas falha o envio', async () => {
    received.length = 0
    const result = await submit('/avariado')

    // O caso que justifica o produto: o formulário parece funcionar, o
    // visitante carrega em enviar, e nada chega a ninguém.
    expect(result.submitted).toBe(false)
    expect(result.validationErrors[0]).toContain('Ocorreu um erro')
    expect(result.reason).toContain('rejeitou a submissão')
    expect(received).toHaveLength(0)
  }, 60_000)

  it('escolhe a primeira opção real de um select obrigatório', async () => {
    received.length = 0
    const result = await submit('/select')

    expect(result.submitted).toBe(true)
    expect(received[0]?.assunto).toBe('orcamento')
  }, 60_000)

  it('usa o indicador de sucesso configurado', async () => {
    const result = await submit('/classico', 'Mensagem enviada com sucesso')

    expect(result.submitted).toBe(true)
    expect(result.signal).toBe('indicator')
  }, 60_000)

  it('recusa-se a submeter um formulário de login', async () => {
    const { form, url } = await formAt('/login')
    const plan = buildFillPlan(form, canary)

    await expect(
      submitForm({ browser, pageUrl: url, form, plan, timeoutMs: 20_000 }),
    ).rejects.toBeInstanceOf(FormNotTestableError)
  }, 60_000)

  it('não submete quando há campos obrigatórios por configurar', async () => {
    const { form, url } = await formAt('/classico')
    const plan = buildFillPlan(form, canary)
    plan.unresolvedRequired.push({ name: 'nif', type: 'text', required: true })

    const result = await submitForm({ browser, pageUrl: url, form, plan, timeoutMs: 20_000 })

    expect(result.submitted).toBe(false)
    expect(result.reason).toContain('nif')
  }, 60_000)

  it('reporta quando o formulário desapareceu da página', async () => {
    const { url } = await formAt('/classico')
    const { form } = await formAt('/classico')
    const plan = buildFillPlan(form, canary)

    const result = await submitForm({
      browser,
      pageUrl: url,
      form: { ...form, selector: '#formulario-que-ja-nao-existe' },
      plan,
      timeoutMs: 20_000,
    })

    expect(result.submitted).toBe(false)
    expect(result.reason).toContain('deixou de existir')
  }, 60_000)

  it('captura screenshot quando pedido', async () => {
    const { form, url } = await formAt('/classico')
    const plan = buildFillPlan(form, canary)

    const result = await submitForm({
      browser,
      pageUrl: url,
      form,
      plan,
      timeoutMs: 20_000,
      captureScreenshot: true,
    })

    expect(result.screenshot?.length).toBeGreaterThan(0)
  }, 60_000)
})
