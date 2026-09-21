import { describe, expect, it } from 'vitest'
import { buildCanaryIdentity, buildFillPlan, inferFieldRole } from './canary.js'
import { discoverForms, type DiscoveredField } from './discovery.js'

const canary = buildCanaryIdentity({
  siteId: 'site1',
  domain: 'check.jellycare.pt',
  tokenGenerator: () => 'abc123',
})

function field(overrides: Partial<DiscoveredField>): DiscoveredField {
  return { name: '', type: 'text', required: false, ...overrides }
}

describe('buildCanaryIdentity', () => {
  it('constrói um endereço com o site e o token', () => {
    expect(canary.address).toBe('check+site1-abc123@check.jellycare.pt')
    expect(canary.token).toBe('abc123')
  })

  it('deixa claro no corpo que é um teste automático e não precisa de resposta', () => {
    expect(canary.message).toContain('automaticamente pela plataforma Jellycare')
    expect(canary.message).toContain('não precisa de resposta')
    // O token no corpo permite casar o email recebido com a submissão mesmo
    // quando o formulário reescreve o remetente.
    expect(canary.message).toContain('abc123')
  })

  it('usa um telefone que não encaminha para ninguém', () => {
    expect(canary.phone).toBe('+351200000000')
  })

  it('gera tokens distintos por omissão', () => {
    const a = buildCanaryIdentity({ siteId: 's', domain: 'd.pt' })
    const b = buildCanaryIdentity({ siteId: 's', domain: 'd.pt' })
    expect(a.token).not.toBe(b.token)
  })
})

describe('inferFieldRole', () => {
  it('usa o tipo do input quando é inequívoco', () => {
    expect(inferFieldRole(field({ type: 'email', name: 'x' }))).toBe('email')
    expect(inferFieldRole(field({ type: 'tel', name: 'x' }))).toBe('phone')
    expect(inferFieldRole(field({ type: 'textarea', name: 'x' }))).toBe('message')
  })

  it('deduz pelo nome em português e em inglês', () => {
    expect(inferFieldRole(field({ name: 'nome' }))).toBe('name')
    expect(inferFieldRole(field({ name: 'telemovel' }))).toBe('phone')
    expect(inferFieldRole(field({ name: 'empresa' }))).toBe('company')
    expect(inferFieldRole(field({ name: 'assunto' }))).toBe('subject')
    expect(inferFieldRole(field({ name: 'your-message' }))).toBe('message')
  })

  it('distingue primeiro nome e apelido de nome completo', () => {
    // "first name" contém "name": a ordem dos padrões tem de os apanhar primeiro.
    expect(inferFieldRole(field({ name: 'first_name' }))).toBe('first_name')
    expect(inferFieldRole(field({ name: 'apelido' }))).toBe('last_name')
    expect(inferFieldRole(field({ name: 'nome' }))).toBe('name')
  })

  it('usa o label quando o nome é opaco', () => {
    expect(inferFieldRole(field({ name: 'field_7', label: 'O seu email' }))).toBe('email')
  })

  it('reconhece uma checkbox de consentimento', () => {
    expect(inferFieldRole(field({ type: 'checkbox', name: 'rgpd' }))).toBe('consent')
    expect(inferFieldRole(field({ type: 'checkbox', name: 'aceito-termos' }))).toBe('consent')
  })

  it('devolve desconhecido quando não há pistas', () => {
    expect(inferFieldRole(field({ name: 'campo_42' }))).toBe('unknown')
  })
})

describe('buildFillPlan', () => {
  function planFor(html: string) {
    const form = discoverForms(html, 'https://cliente.pt/contactos')[0]!
    return buildFillPlan(form, canary)
  }

  it('preenche um formulário de contacto completo', () => {
    const plan = planFor(`
      <form id="c" method="post">
        <input name="nome" required>
        <input name="email" type="email" required>
        <input name="telefone" type="tel">
        <textarea name="mensagem" required></textarea>
      </form>
    `)

    const byName = Object.fromEntries(plan.fills.map((fill) => [fill.field.name, fill.value]))
    expect(byName.nome).toBe('Jellycare Monitor')
    expect(byName.email).toBe('check+site1-abc123@check.jellycare.pt')
    expect(byName.telefone).toBe('+351200000000')
    expect(byName.mensagem).toContain('abc123')
    expect(plan.unresolvedRequired).toEqual([])
  })

  it('nunca escreve em campos escondidos', () => {
    const plan = planFor(`
      <form id="c" method="post">
        <input type="hidden" name="_wpnonce" value="abc">
        <input name="email" type="email">
        <textarea name="mensagem"></textarea>
      </form>
    `)

    // Escrever por cima de um nonce parte a submissão e daria um falso
    // positivo de "formulário avariado".
    expect(plan.fills.some((fill) => fill.field.name === '_wpnonce')).toBe(false)
  })

  it('marca o consentimento obrigatório', () => {
    const plan = planFor(`
      <form id="c" method="post">
        <input name="email" type="email">
        <textarea name="mensagem"></textarea>
        <input type="checkbox" name="rgpd" required>
      </form>
    `)

    const consent = plan.fills.find((fill) => fill.role === 'consent')
    expect(consent?.action).toBe('check')
  })

  it('ignora consentimentos opcionais, como o de marketing', () => {
    const plan = planFor(`
      <form id="c" method="post">
        <input name="email" type="email">
        <textarea name="mensagem"></textarea>
        <input type="checkbox" name="aceito-newsletter">
      </form>
    `)

    expect(plan.fills.some((fill) => fill.role === 'consent')).toBe(false)
  })

  it('escolhe a primeira opção real de um select obrigatório', () => {
    const plan = planFor(`
      <form id="c" method="post">
        <input name="email" type="email">
        <textarea name="mensagem"></textarea>
        <select name="assunto" required>
          <option value="">Escolha um assunto</option>
          <option value="orcamento">Orçamento</option>
        </select>
      </form>
    `)

    const choice = plan.fills.find((fill) => fill.field.name === 'assunto')
    expect(choice).toMatchObject({ action: 'select', value: 'orcamento' })
  })

  it('sinaliza campos obrigatórios que não consegue deduzir', () => {
    const plan = planFor(`
      <form id="c" method="post">
        <input name="email" type="email">
        <textarea name="mensagem"></textarea>
        <input name="numero_contribuinte" required>
      </form>
    `)

    // Preferível pedir configuração manual a inventar um valor e meter lixo
    // no CRM do cliente.
    expect(plan.unresolvedRequired.map((f) => f.name)).toEqual(['numero_contribuinte'])
  })

  it('não sinaliza campos opcionais desconhecidos', () => {
    const plan = planFor(`
      <form id="c" method="post">
        <input name="email" type="email">
        <textarea name="mensagem"></textarea>
        <input name="como_nos_conheceu">
      </form>
    `)

    expect(plan.unresolvedRequired).toEqual([])
  })
})

describe('formulários validados por JavaScript', () => {
  const canary = buildCanaryIdentity({
    siteId: 'site1',
    domain: 'check.jellycare.pt',
    tokenGenerator: () => 'abc12345',
  })

  function planFor(html: string) {
    const [form] = discoverForms(html, 'https://cliente.pt/contacto')
    return { form: form!, plan: buildFillPlan(form!, canary) }
  }

  it('lê o asterisco da label como marca de obrigatoriedade', () => {
    // Num formulário validado por JavaScript nada tem o atributo `required`:
    // a regra vive no código. O asterisco é o que o autor pôs para o dizer.
    const { form } = planFor(`<form>
      <label>O seu nome *<input type="text"></label>
      <label>Empresa<input type="text"></label>
    </form>`)

    expect(form.fields[0]?.required).toBe(true)
    expect(form.fields[1]?.required).toBe(false)
  })

  it('ignora um asterisco perdido no meio de um texto de ajuda', () => {
    const { form } = planFor(`<form>
      <label>Telefone<input type="text"> Usamos isto apenas para responder mais depressa, nunca para outra coisa, e podemos apagá-lo a pedido *sujeito a confirmação</label>
    </form>`)

    expect(form.fields[0]?.required).toBe(false)
  })

  it('marca o consentimento mesmo sem ele estar declarado obrigatório', () => {
    // Consentir o tratamento do pedido é inerente a submetê-lo. Deixar por
    // marcar fazia a submissão ser rejeitada e reportávamos como avariado um
    // formulário de perfeita saúde.
    const { plan } = planFor(`<form>
      <label>Email *<input type="email"></label>
      <label><input type="checkbox"> Autorizo o tratamento destes dados nos termos da política de privacidade.</label>
    </form>`)

    const consentimento = plan.fills.find((fill) => fill.role === 'consent')
    expect(consentimento).toBeDefined()
    expect(consentimento?.action).toBe('check')
  })

  it('nunca subscreve a caixa canária em comunicações de marketing', () => {
    // Inscrever a caixa na lista do cliente não é direito nosso, e "aceito
    // receber" casa com o padrão de consentimento — daí a exclusão explícita.
    const { plan } = planFor(`<form>
      <label>Email *<input type="email"></label>
      <label><input type="checkbox"> Aceito receber a newsletter com novidades e ofertas.</label>
    </form>`)

    expect(plan.fills.some((fill) => fill.role === 'consent')).toBe(false)
    expect(plan.fills.some((fill) => fill.action === 'check')).toBe(false)
  })

  it('deixa por resolver uma adesão a marketing que seja obrigatória', () => {
    // Não a marcamos por iniciativa própria: fica para configuração manual,
    // com uma pessoa a decidir.
    const { plan } = planFor(`<form>
      <label><input type="checkbox" required> Aceito receber comunicações comerciais *</label>
    </form>`)

    expect(plan.unresolvedRequired).toHaveLength(1)
    expect(plan.fills.some((fill) => fill.action === 'check')).toBe(false)
  })
})
