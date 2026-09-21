import { describe, expect, it } from 'vitest'
import { discoverForms, isTestable } from './discovery.js'

const PAGE = 'https://cliente.pt/contactos'

function discover(html: string) {
  return discoverForms(html, PAGE)
}

function single(html: string) {
  const forms = discover(html)
  expect(forms).toHaveLength(1)
  return forms[0]!
}

describe('discoverForms — classificação', () => {
  it('reconhece um formulário de contacto típico', () => {
    const form = single(`
      <form id="contacto" method="post" action="/enviar">
        <label for="nome">Nome</label><input id="nome" name="nome" required>
        <label for="email">Email</label><input id="email" name="email" type="email" required>
        <textarea name="mensagem" required></textarea>
        <button type="submit">Enviar</button>
      </form>
    `)

    expect(form.kind).toBe('contact')
    expect(isTestable(form)).toBe(true)
    expect(form.selector).toBe('#contacto')
    expect(form.action).toBe('https://cliente.pt/enviar')
    expect(form.submitText).toBe('Enviar')
  })

  it('nunca submete um formulário de login', () => {
    const form = single(`
      <form id="entrar" method="post">
        <input name="email" type="email">
        <input name="password" type="password">
      </form>
    `)

    expect(form.kind).toBe('login')
    expect(isTestable(form)).toBe(false)
    expect(form.excludedReason).toContain('autenticação')
  })

  it('distingue registo de login pela confirmação de palavra-passe', () => {
    const form = single(`
      <form method="post">
        <input name="email" type="email">
        <input name="password" type="password">
        <input name="password_confirm" type="password">
      </form>
    `)

    expect(form.kind).toBe('registration')
  })

  it('a palavra-passe ganha mesmo quando há email e caixa de mensagem', () => {
    // Na dúvida, não se submete. Um formulário com password não é de contacto.
    const form = single(`
      <form id="contacto" method="post">
        <input name="email" type="email">
        <textarea name="mensagem"></textarea>
        <input name="password" type="password">
      </form>
    `)

    expect(form.kind).toBe('login')
    expect(isTestable(form)).toBe(false)
  })

  it('nunca submete um formulário de pagamento', () => {
    const form = single(`
      <form method="post" action="/checkout">
        <input name="email" type="email">
        <textarea name="notas"></textarea>
      </form>
    `)

    expect(form.kind).toBe('commerce')
    expect(isTestable(form)).toBe(false)
  })

  it('deteta campos de cartão mesmo sem pistas no action', () => {
    const form = single(`
      <form method="post">
        <input name="email" type="email">
        <input name="cc-number">
        <input name="cvv">
      </form>
    `)

    expect(form.kind).toBe('commerce')
  })

  it('ignora o formulário de pesquisa', () => {
    const form = single(`
      <form method="get" action="/">
        <input name="s" type="text" placeholder="Pesquisar">
      </form>
    `)

    expect(form.kind).toBe('search')
    expect(isTestable(form)).toBe(false)
  })

  it('não submete subscrições de newsletter', () => {
    const form = single(`
      <form class="newsletter-form" method="post" action="/subscrever">
        <input name="email" type="email" required>
      </form>
    `)

    expect(form.kind).toBe('newsletter')
    expect(form.excludedReason).toContain('lista do cliente')
  })

  it('trata um formulário com só email como newsletter, por precaução', () => {
    const form = single('<form method="post"><input name="email" type="email"></form>')
    expect(isTestable(form)).toBe(false)
  })

  it('aceita um formulário de contacto identificado pela classe, sem textarea', () => {
    const form = single(`
      <form class="wpcf7-form contacto-rapido" method="post">
        <input name="nome">
        <input name="email" type="email">
        <input name="telefone" type="tel">
      </form>
    `)

    expect(form.kind).toBe('contact')
  })

  it('marca como desconhecido o que não consegue classificar', () => {
    const form = single('<form method="post"><input name="codigo"></form>')
    expect(form.kind).toBe('unknown')
    expect(form.excludedReason).toContain('Configure-o manualmente')
  })
})

describe('discoverForms — extração de campos', () => {
  it('lê tipo, obrigatoriedade e etiqueta', () => {
    const form = single(`
      <form id="c">
        <label for="email">O seu email</label>
        <input id="email" name="email" type="email" required placeholder="nome@exemplo.pt">
        <textarea name="mensagem"></textarea>
      </form>
    `)

    expect(form.fields[0]).toMatchObject({
      name: 'email',
      type: 'email',
      required: true,
      label: 'O seu email',
      placeholder: 'nome@exemplo.pt',
    })
    expect(form.fields[1]?.type).toBe('textarea')
  })

  it('guarda as opções de um select', () => {
    const form = single(`
      <form id="c">
        <input name="email" type="email">
        <textarea name="m"></textarea>
        <select name="assunto" required>
          <option value="">Escolha</option>
          <option value="orcamento">Orçamento</option>
          <option value="suporte">Suporte</option>
        </select>
      </form>
    `)

    const select = form.fields.find((field) => field.name === 'assunto')
    expect(select?.options).toEqual(['orcamento', 'suporte'])
  })

  it('mantém os campos escondidos, que costumam ser nonces', () => {
    const form = single(`
      <form id="c">
        <input type="hidden" name="_wpnonce" value="abc123">
        <input name="email" type="email">
        <textarea name="m"></textarea>
      </form>
    `)

    expect(form.fields.some((field) => field.type === 'hidden')).toBe(true)
  })

  it('ignora botões', () => {
    const form = single(`
      <form id="c">
        <input name="email" type="email">
        <textarea name="m"></textarea>
        <input type="submit" value="Enviar">
        <button type="button">Limpar</button>
      </form>
    `)

    expect(form.fields.map((field) => field.name)).toEqual(['email', 'm'])
  })
})

describe('discoverForms — captcha e seletores', () => {
  it('deteta reCAPTCHA', () => {
    const form = single(`
      <form id="c">
        <input name="email" type="email"><textarea name="m"></textarea>
        <div class="g-recaptcha" data-sitekey="x"></div>
      </form>
    `)

    expect(form.captcha).toBe('recaptcha')
  })

  it('deteta Turnstile carregado ao nível da página', () => {
    const forms = discover(`
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
      <form id="c"><input name="email" type="email"><textarea name="m"></textarea></form>
    `)

    expect(forms[0]?.captcha).toBe('turnstile')
  })

  it('usa o name quando não há id', () => {
    const form = single('<form name="contacto"><input name="email" type="email"><textarea name="m"></textarea></form>')
    expect(form.selector).toBe('form[name="contacto"]')
  })

  it('cai para a posição quando não há id nem name', () => {
    const forms = discover(`
      <form><input name="s" type="search"></form>
      <form><input name="email" type="email"><textarea name="m"></textarea></form>
    `)

    expect(forms[1]?.selector).toBe('form:nth-of-type(2)')
  })

  it('escapa ids com caracteres especiais', () => {
    const form = single('<form id="form:contacto"><input name="email" type="email"><textarea name="m"></textarea></form>')
    expect(form.selector).toBe('#form\\:contacto')
  })

  it('encontra vários formulários na mesma página', () => {
    const forms = discover(`
      <form method="get"><input name="s" type="search"></form>
      <form id="contacto" method="post"><input name="email" type="email"><textarea name="m"></textarea></form>
      <form class="newsletter" method="post"><input name="email" type="email"></form>
    `)

    expect(forms.map((form) => form.kind)).toEqual(['search', 'contact', 'newsletter'])
    expect(forms.filter(isTestable)).toHaveLength(1)
  })
})

describe('formulários controlados por JavaScript', () => {
  // A forma real encontrada em produção: React, campos sem `name`, sem `id` e
  // sem labels, formulário sem `action`. A descoberta descartava todos os
  // campos e o formulário ficava invisível.
  const REACT_FORM = `<!doctype html><html><body>
    <form class="page_form__xoJzE">
      <input class="page_input__Fj8Eu" type="text" placeholder="O seu nome">
      <input class="page_input__Fj8Eu" type="email" placeholder="Email">
      <textarea class="page_textarea__Bzglk" rows="7" placeholder="Mensagem"></textarea>
      <select class="page_select___e2L8"><option value="">Assunto</option><option value="geral">Geral</option></select>
      <button type="submit">Enviar</button>
    </form>
  </body></html>`

  it('descobre o formulário apesar de nenhum campo ter nome', () => {
    const [form] = discoverForms(REACT_FORM, 'https://cliente.pt/contacto')

    expect(form).toBeDefined()
    expect(form?.fields).toHaveLength(4)
    expect(form?.fields.every((field) => field.name === '')).toBe(true)
  })

  it('classifica-o como formulário de contacto', () => {
    const [form] = discoverForms(REACT_FORM, 'https://cliente.pt/contacto')

    expect(form?.kind).toBe('contact')
    expect(form?.excludedReason).toBeUndefined()
  })

  it('numera os campos pela posição, para os voltar a encontrar', () => {
    const [form] = discoverForms(REACT_FORM, 'https://cliente.pt/contacto')

    expect(form?.fields.map((field) => field.ordinal)).toEqual([0, 1, 2, 3])
  })

  it('lê o aria-label e o autocomplete quando existem', () => {
    const html = `<form>
      <input type="text" aria-label="Nome completo" autocomplete="name">
      <input type="email" autocomplete="email">
    </form>`

    const [form] = discoverForms(html, 'https://cliente.pt/contacto')

    expect(form?.fields[0]?.ariaLabel).toBe('Nome completo')
    expect(form?.fields[0]?.autocomplete).toBe('name')
    expect(form?.fields[1]?.autocomplete).toBe('email')
  })
})
