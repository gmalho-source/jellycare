import * as cheerio from 'cheerio'

/**
 * Natureza de um formulário.
 *
 * Só `contact` é submetido automaticamente. Todos os outros são registados
 * para o dashboard mas nunca preenchidos: submeter um formulário de compra,
 * registo ou pagamento no site de um cliente é um erro que não se desfaz.
 * Ver docs/riscos.md.
 */
export type FormKind =
  | 'contact'
  | 'search'
  | 'login'
  | 'registration'
  | 'commerce'
  | 'newsletter'
  | 'unknown'

export interface DiscoveredField {
  /**
   * O atributo `name`, ou vazio quando não existe.
   *
   * Num formulário controlado por JavaScript — React, Vue, Svelte — o estado
   * vive no código e o `name` deixa de ter função, por isso é comum não
   * existir em campo nenhum. Um campo sem nome continua a ser um campo.
   */
  name: string
  /** Tipo do input, ou `textarea` / `select`. */
  type: string
  /**
   * Posição entre os `input`, `textarea` e `select` do formulário.
   *
   * É o que permite voltar a encontrar um campo que não tem `name` nem `id`.
   * Conta todos os controlos, incluindo botões, para que a contagem coincida
   * com a que o browser faz ao localizar o campo na página.
   */
  ordinal: number
  id?: string
  placeholder?: string
  label?: string
  /** `aria-label`: em formulários sem labels visíveis é o que resta. */
  ariaLabel?: string
  /** `autocomplete`: diz o papel do campo melhor do que qualquer heurística. */
  autocomplete?: string
  required: boolean
  /** Valores disponíveis, para `select`. */
  options?: string[]
}

export interface DiscoveredForm {
  /** Seletor CSS estável para reencontrar o formulário na página. */
  selector: string
  action: string | null
  method: string
  fields: DiscoveredField[]
  submitText?: string
  kind: FormKind
  /** Porque é que este formulário não é submetido. */
  excludedReason?: string
  /** O formulário está protegido por um captcha que não contornamos. */
  captcha?: 'recaptcha' | 'hcaptcha' | 'turnstile'
}

const PASSWORD_CONFIRM = /(confirm|repet|again|novamente|verifica)/i
const CARD_FIELD = /(cc-number|cardnumber|card_number|creditcard|cvv|cvc|card-expiry|expiry|iban|nib|mbway)/i
const COMMERCE_ACTION = /(checkout|cart|carrinho|payment|pagamento|order|encomenda|donate|doacao|subscri(be|cao)-plano)/i
const LOGIN_ACTION = /(login|signin|sign-in|entrar|autentica)/i
const REGISTER_ACTION = /(register|signup|sign-up|registo|registar|criar-conta)/i
const NEWSLETTER_HINT = /(newsletter|subscribe|subscrever|mailchimp|mailerlite|sendinblue|brevo|klaviyo)/i
const CONTACT_HINT = /(contact|contacto|contato|mensagem|message|orcamento|orçamento|quote|enquiry|pedido|fale-connosco|fale-conosco|suporte|support)/i
const SEARCH_FIELD = /^(s|q|search|query|pesquisa|busca|keyword)$/i
const MESSAGE_HINT = /(message|mensagem|comment|comentario|comentário|duvida|dúvida|descricao|descrição|pedido|assunto-detalhe)/i
const EMAIL_HINT = /(e-?mail|correio)/i

/**
 * O asterisco na label, que é como um formulário diz "obrigatório" a quem o vê.
 *
 * Num formulário validado por JavaScript nada tem o atributo `required`: a
 * regra vive no código e o HTML não a declara. Sobra a convenção visual, que é
 * universal e honesta — o autor pô-la lá precisamente para dizer isto.
 *
 * Só conta perto do início: em textos de ajuda longos um asterisco costuma ser
 * uma nota de rodapé e não uma marca de obrigatoriedade.
 */
function marksRequired(label: string | undefined): boolean {
  return label !== undefined && label.slice(0, 80).includes('*')
}

/**
 * Vocabulário de um botão que envia.
 *
 * Num formulário controlado por JavaScript o botão de envio é `type="button"`
 * — não há submissão nativa a desencadear — e então o texto é o único sinal
 * que resta para o distinguir dos outros botões.
 */
export const SUBMIT_TEXT =
  /(enviar|submeter|submit|send|solicitar|pedir|request|contactar|falar|marcar)/i

/**
 * O texto do botão que envia o formulário.
 *
 * Primeiro o que o HTML declara; depois, por vocabulário, os botões que não se
 * declaram. Botões com `aria-pressed` ficam de fora: são alternadores, e o seu
 * texto descreve uma opção e não um envio.
 */
function findSubmitText(
  $: cheerio.CheerioAPI,
  $form: ReturnType<cheerio.CheerioAPI>,
): string | undefined {
  const canonical = $form
    .find('button[type="submit"], input[type="submit"], button:not([type])')
    .first()
  const declared = canonical.text().trim() || canonical.attr('value')?.trim()
  if (declared) return declared

  const candidates = $form.find('button, input[type="button"], [role="button"]').toArray()
  // De trás para a frente: o botão de envio é convencionalmente o último.
  for (const element of candidates.reverse()) {
    const $candidate = $(element)
    if ($candidate.attr('aria-pressed') !== undefined) continue
    const text =
      $candidate.text().trim() ||
      $candidate.attr('value')?.trim() ||
      $candidate.attr('aria-label')?.trim() ||
      ''
    if (text && SUBMIT_TEXT.test(text)) return text
  }

  return undefined
}

function haystack(field: DiscoveredField): string {
  return [
    field.name,
    field.id,
    field.placeholder,
    field.label,
    field.ariaLabel,
    field.autocomplete,
    field.type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function formHaystack(form: Pick<DiscoveredForm, 'action' | 'selector'>, attrs: string): string {
  return `${form.action ?? ''} ${form.selector} ${attrs}`.toLowerCase()
}

function isEmailField(field: DiscoveredField): boolean {
  return field.type === 'email' || EMAIL_HINT.test(haystack(field))
}

function isMessageField(field: DiscoveredField): boolean {
  return field.type === 'textarea' || MESSAGE_HINT.test(haystack(field))
}

export interface ClassificationInput {
  fields: DiscoveredField[]
  action: string | null
  method: string
  /** id, name e class do elemento form, concatenados. */
  attributes: string
  selector: string
}

/**
 * Decide o que é o formulário.
 *
 * A ordem das regras é deliberada: as exclusões vêm primeiro. Um formulário
 * com campo de palavra-passe é de autenticação mesmo que também tenha email e
 * uma caixa de texto; na dúvida, não se submete.
 */
export function classifyForm(input: ClassificationInput): {
  kind: FormKind
  excludedReason?: string
} {
  const { fields, action, method } = input
  const attrs = formHaystack({ action, selector: input.selector }, input.attributes)

  const passwords = fields.filter((field) => field.type === 'password')
  if (passwords.length > 0) {
    const confirming =
      passwords.length > 1 || passwords.some((field) => PASSWORD_CONFIRM.test(haystack(field)))
    const kind: FormKind =
      confirming || REGISTER_ACTION.test(attrs) ? 'registration' : 'login'
    return {
      kind,
      excludedReason: 'Formulário de autenticação: nunca é submetido automaticamente.',
    }
  }

  if (fields.some((field) => CARD_FIELD.test(haystack(field))) || COMMERCE_ACTION.test(attrs)) {
    return {
      kind: 'commerce',
      excludedReason:
        'Formulário de compra, pagamento ou encomenda: nunca é submetido automaticamente.',
    }
  }

  if (LOGIN_ACTION.test(attrs)) {
    return { kind: 'login', excludedReason: 'Formulário de autenticação: nunca é submetido.' }
  }
  if (REGISTER_ACTION.test(attrs)) {
    return { kind: 'registration', excludedReason: 'Formulário de registo: nunca é submetido.' }
  }

  const visibleFields = fields.filter((field) => field.type !== 'hidden')

  const isSearch =
    fields.some((field) => field.type === 'search') ||
    (method.toLowerCase() === 'get' &&
      visibleFields.length <= 2 &&
      visibleFields.some((field) => SEARCH_FIELD.test(field.name)))
  if (isSearch) {
    return { kind: 'search', excludedReason: 'Formulário de pesquisa: não gera notificação.' }
  }

  const hasEmail = fields.some(isEmailField)
  const hasMessage = fields.some(isMessageField)

  if (hasEmail && (hasMessage || CONTACT_HINT.test(attrs))) {
    return { kind: 'contact' }
  }

  if (hasEmail && (NEWSLETTER_HINT.test(attrs) || visibleFields.length <= 2)) {
    return {
      kind: 'newsletter',
      excludedReason:
        'Subscrição de newsletter: submeter acrescentaria um contacto falso à lista do cliente.',
    }
  }

  return {
    kind: 'unknown',
    excludedReason:
      'Não foi possível determinar a natureza do formulário. Configure-o manualmente para o ' +
      'incluir na monitorização.',
  }
}

/**
 * Escapa um id para uso num seletor CSS. `CSS.escape` só existe no browser e
 * a descoberta corre no worker, sem DOM.
 */
function escapeSelectorId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)
}

function detectCaptcha(html: string): DiscoveredForm['captcha'] {
  if (/g-recaptcha|recaptcha\/api\.js|grecaptcha/i.test(html)) return 'recaptcha'
  if (/h-captcha|hcaptcha\.com/i.test(html)) return 'hcaptcha'
  if (/cf-turnstile|challenges\.cloudflare\.com/i.test(html)) return 'turnstile'
  return undefined
}

/** Encontra os formulários de uma página e classifica cada um. */
export function discoverForms(html: string, pageUrl: string): DiscoveredForm[] {
  const $ = cheerio.load(html)
  const pageCaptcha = detectCaptcha(html)
  const forms: DiscoveredForm[] = []

  $('form').each((index, element) => {
    const $form = $(element)
    const id = $form.attr('id')
    const name = $form.attr('name')

    // Um id é o seletor mais estável; sem ele, a posição na página serve, com o
    // risco assumido de mudar se a estrutura mudar.
    const selector = id
      ? `#${escapeSelectorId(id)}`
      : name
        ? `form[name="${name}"]`
        : `form:nth-of-type(${index + 1})`

    const fields: DiscoveredField[] = []

    // O ordinal conta todos os controlos, incluindo os botões que a seguir são
    // ignorados: é a mesma contagem que o browser faz ao procurar o campo, e
    // desalinhá-la faria escrever no campo errado.
    $form.find('input, textarea, select').each((ordinal, input) => {
      const $input = $(input)
      const tag = (input as { tagName?: string }).tagName?.toLowerCase() ?? 'input'
      const type = tag === 'input' ? ($input.attr('type') ?? 'text').toLowerCase() : tag
      const fieldName = $input.attr('name') ?? $input.attr('id') ?? ''

      if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') return

      const fieldId = $input.attr('id')
      const label = fieldId
        ? $form.find(`label[for="${fieldId}"]`).first().text().trim() || undefined
        : $input.closest('label').text().trim() || undefined

      const field: DiscoveredField = {
        name: fieldName,
        type,
        ordinal,
        required:
          $input.attr('required') !== undefined ||
          $input.attr('aria-required') === 'true' ||
          marksRequired(label),
      }
      const ariaLabel = $input.attr('aria-label')
      if (ariaLabel) field.ariaLabel = ariaLabel
      const autocomplete = $input.attr('autocomplete')
      if (autocomplete && autocomplete !== 'off') field.autocomplete = autocomplete
      if (fieldId) field.id = fieldId
      const placeholder = $input.attr('placeholder')
      if (placeholder) field.placeholder = placeholder
      if (label) field.label = label
      if (tag === 'select') {
        field.options = $input
          .find('option')
          .map((_, option) => $(option).attr('value') ?? $(option).text())
          .get()
          .filter((value) => value.trim() !== '')
      }

      fields.push(field)
    })

    const rawAction = $form.attr('action') ?? null
    let action = rawAction
    if (rawAction) {
      try {
        action = new URL(rawAction, pageUrl).toString()
      } catch {
        action = rawAction
      }
    }

    const attributes = [id, name, $form.attr('class')].filter(Boolean).join(' ')
    const { kind, excludedReason } = classifyForm({
      fields,
      action,
      method: $form.attr('method') ?? 'get',
      attributes,
      selector,
    })

    const submitText = findSubmitText($, $form)

    const discovered: DiscoveredForm = {
      selector,
      action,
      method: ($form.attr('method') ?? 'get').toLowerCase(),
      fields,
      kind,
    }
    if (submitText) discovered.submitText = submitText
    if (excludedReason) discovered.excludedReason = excludedReason

    // O captcha pode estar dentro do formulário ou ser carregado ao nível da
    // página; ambas as formas contam.
    const formCaptcha = detectCaptcha($.html($form)) ?? pageCaptcha
    if (formCaptcha) discovered.captcha = formCaptcha

    forms.push(discovered)
  })

  return forms
}

/** Só formulários de contacto são submetidos. */
export function isTestable(form: DiscoveredForm): boolean {
  return form.kind === 'contact'
}
