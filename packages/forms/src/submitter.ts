import type { Browser, Page, Response as PlaywrightResponse } from 'playwright'
import { USER_AGENT } from '@jellycare/core'
import type { FillPlan } from './canary.js'
import { isTestable, type DiscoveredForm } from './discovery.js'

export interface SubmitOptions {
  browser: Browser
  pageUrl: string
  form: DiscoveredForm
  plan: FillPlan
  /** Texto ou seletor que confirma a submissão, configurado por formulário. */
  successIndicator?: string
  timeoutMs?: number
  captureScreenshot?: boolean
}

export type SuccessSignal = 'indicator' | 'redirect' | 'form_replaced' | 'network_ok'

export interface SubmitResult {
  submitted: boolean
  /** Como se concluiu que a submissão passou. */
  signal: SuccessSignal | null
  reason?: string
  finalUrl: string
  /** Mensagens de erro de validação apanhadas na página. */
  validationErrors: string[]
  screenshot?: Buffer
  durationMs: number
}

/** Seletores onde os formulários mais comuns escrevem os erros de validação. */
const ERROR_SELECTORS = [
  '.wpcf7-not-valid-tip',
  '.wpcf7-response-output.wpcf7-validation-errors',
  '.wpforms-error',
  '.gfield_error .validation_message',
  '.nf-error-msg',
  '.frm_error',
  '[aria-invalid="true"] ~ .error',
  '.error-message',
  '.form-error',
  '[role="alert"]',
]

const SUCCESS_SELECTORS = [
  '.wpcf7-response-output.wpcf7-mail-sent-ok',
  '.wpforms-confirmation-container',
  '.gform_confirmation_message',
  '.nf-response-msg',
  '.frm_message',
]

const SUCCESS_TEXT =
  /(obrigad|mensagem enviada|enviada com sucesso|recebemos|em breve entraremos|thank you|message sent|successfully sent|we.ll be in touch)/i

export class FormNotTestableError extends Error {
  constructor(kind: string, reason?: string) {
    super(`Formulário do tipo "${kind}" não é submetido automaticamente. ${reason ?? ''}`.trim())
    this.name = 'FormNotTestableError'
  }
}

async function collectValidationErrors(page: Page): Promise<string[]> {
  const messages: string[] = []
  for (const selector of ERROR_SELECTORS) {
    const texts = await page
      .locator(selector)
      .allInnerTexts()
      .catch(() => [] as string[])
    for (const text of texts) {
      const trimmed = text.trim()
      if (trimmed) messages.push(trimmed)
    }
  }
  return [...new Set(messages)].slice(0, 10)
}

/**
 * Preenche e submete um formulário de contacto num browser real.
 *
 * Browser real e não um POST direto porque a maior parte dos formulários
 * modernos valida e submete por JavaScript: um POST construído à mão passaria
 * em sítios onde o visitante falha, e falharia em sítios onde o visitante
 * passa. O objetivo é reproduzir o que uma pessoa faz.
 */
export async function submitForm(options: SubmitOptions): Promise<SubmitResult> {
  const { browser, pageUrl, form, plan } = options
  const timeoutMs = options.timeoutMs ?? 30_000
  const startedAt = Date.now()

  // Defesa em profundidade: a classificação já filtrou, mas esta função não
  // depende de quem a chama ter feito isso.
  if (!isTestable(form)) throw new FormNotTestableError(form.kind, form.excludedReason)

  if (plan.unresolvedRequired.length > 0) {
    return {
      submitted: false,
      signal: null,
      reason:
        'Campos obrigatórios por configurar: ' +
        plan.unresolvedRequired.map((field) => field.name).join(', '),
      finalUrl: pageUrl,
      validationErrors: [],
      durationMs: Date.now() - startedAt,
    }
  }

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'pt-PT',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(timeoutMs)

  // O estado da resposta ao POST é o sinal mais fiável quando a página não
  // muda nada de visível.
  let submissionResponse: PlaywrightResponse | null = null
  page.on('response', (response) => {
    const request = response.request()
    if (request.method() === 'POST' && !submissionResponse) submissionResponse = response
  })

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })

    const formLocator = page.locator(form.selector).first()
    if ((await formLocator.count()) === 0) {
      return {
        submitted: false,
        signal: null,
        reason: `O formulário deixou de existir na página (seletor ${form.selector}).`,
        finalUrl: page.url(),
        validationErrors: [],
        durationMs: Date.now() - startedAt,
      }
    }

    for (const fill of plan.fills) {
      const target = fill.field.id
        ? formLocator.locator(`#${CSS_ESCAPE(fill.field.id)}`)
        : fill.field.name
          ? formLocator.locator(`[name="${fill.field.name}"]`)
          : // Sem `name` nem `id` resta a posição. É menos estável — mudar a
            // ordem dos campos muda o alvo — mas é a única forma de chegar a
            // um formulário controlado por JavaScript, que é como se escrevem
            // hoje. A descoberta corre antes de cada teste, por isso a
            // posição vem sempre da página atual e não de um registo antigo.
            formLocator.locator('input, textarea, select').nth(fill.field.ordinal)
      const element = target.first()

      if ((await element.count()) === 0) continue

      switch (fill.action) {
        case 'fill':
          await element.fill(fill.value ?? '')
          break
        case 'check':
          await element.check({ force: true })
          break
        case 'select':
          await element.selectOption(fill.value ?? '')
          break
      }
    }

    const urlBefore = page.url()

    const submitButton = formLocator
      .locator('button[type="submit"], input[type="submit"], button:not([type])')
      .first()

    if ((await submitButton.count()) > 0) {
      await submitButton.click({ timeout: timeoutMs })
    } else {
      // Sem botão identificável, Enter no último campo de texto é o que um
      // visitante faria.
      await formLocator.locator('input, textarea').last().press('Enter')
    }

    // Dar tempo à página de reagir: redirect, resposta AJAX ou mensagem inline.
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {})

    const finalUrl = page.url()
    const validationErrors = await collectValidationErrors(page)

    let signal: SuccessSignal | null = null

    if (options.successIndicator) {
      const indicator = options.successIndicator
      const bySelector = await page
        .locator(indicator)
        .first()
        .isVisible()
        .catch(() => false)
      const byText = (await page.content()).includes(indicator)
      if (bySelector || byText) signal = 'indicator'
    }

    if (!signal && finalUrl !== urlBefore) signal = 'redirect'

    if (!signal) {
      for (const selector of SUCCESS_SELECTORS) {
        const visible = await page
          .locator(selector)
          .first()
          .isVisible()
          .catch(() => false)
        if (visible) {
          signal = 'form_replaced'
          break
        }
      }
    }

    if (!signal) {
      const bodyText = await page.locator('body').innerText().catch(() => '')
      if (SUCCESS_TEXT.test(bodyText)) signal = 'form_replaced'
    }

    if (!signal && submissionResponse) {
      const status = (submissionResponse as PlaywrightResponse).status()
      if (status >= 200 && status < 400) signal = 'network_ok'
    }

    const screenshot = options.captureScreenshot
      ? await page.screenshot({ fullPage: false }).catch(() => undefined)
      : undefined

    const submitted = signal !== null && validationErrors.length === 0

    const result: SubmitResult = {
      submitted,
      signal: submitted ? signal : null,
      finalUrl,
      validationErrors,
      durationMs: Date.now() - startedAt,
    }
    if (!submitted) {
      result.reason =
        validationErrors.length > 0
          ? `O formulário rejeitou a submissão: ${validationErrors.join(' | ')}`
          : 'Não foi possível confirmar que a submissão foi aceite.'
    }
    if (screenshot) result.screenshot = screenshot

    return result
  } finally {
    await context.close().catch(() => {})
  }
}

/** Escape de id para seletor, sem depender do `CSS` global do browser. */
function CSS_ESCAPE(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)
}
