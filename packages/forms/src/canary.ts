import { randomBytes } from 'node:crypto'
import type { DiscoveredField, DiscoveredForm } from './discovery.js'

/**
 * Dados usados para preencher um formulário de teste.
 *
 * Tudo aqui é deliberadamente identificável. O cliente tem de conseguir
 * filtrar estas submissões no CRM sem esforço, e quem receber o email tem de
 * perceber em dois segundos que não é um lead. Ver docs/riscos.md.
 */
export interface CanaryIdentity {
  /** Token único deste run. Aparece no corpo da mensagem e no endereço. */
  token: string
  /** Endereço com subendereçamento, ex. check+s1-abc123@check.jellycare.pt */
  address: string
  name: string
  phone: string
  company: string
  subject: string
  message: string
}

export interface CanaryOptions {
  siteId: string
  /** Domínio da inbox canária, separado do domínio principal da Jelly. */
  domain: string
  /** Nome visível da agência no corpo da mensagem. */
  agency?: string
  /** Injetável para tornar os testes determinísticos. */
  tokenGenerator?: () => string
}

/**
 * Número de telefone que não encaminha para lado nenhum.
 *
 * O prefixo 2xx é geográfico em Portugal e o bloco 000 000 não está atribuído,
 * por isso passa validação de formato sem chegar a ninguém.
 */
const UNROUTABLE_PHONE = '+351200000000'

export function generateToken(): string {
  return randomBytes(8).toString('hex')
}

export function buildCanaryIdentity(options: CanaryOptions): CanaryIdentity {
  const token = (options.tokenGenerator ?? generateToken)()
  const agency = options.agency ?? 'Jelly'

  // O siteId vai no endereço para que a inbox saiba de que site veio a
  // mensagem mesmo que o corpo tenha sido reescrito pelo formulário.
  const address = `check+${options.siteId}-${token}@${options.domain}`

  return {
    token,
    address,
    name: 'Jellycare Monitor',
    phone: UNROUTABLE_PHONE,
    company: `${agency} — Jellycare`,
    subject: 'Teste automático de monitorização Jellycare',
    message:
      'Esta mensagem foi enviada automaticamente pela plataforma Jellycare para verificar que ' +
      'o formulário de contacto deste site continua a funcionar e que as notificações por email ' +
      'estão a ser entregues.\n\n' +
      'Não é um pedido de contacto e não precisa de resposta. Pode ignorá-la ou eliminá-la.\n\n' +
      `Referência do teste: ${token}\n` +
      `Monitorização por ${agency} — https://jellycare.pt`,
  }
}

export type FieldRole =
  | 'email'
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'company'
  | 'subject'
  | 'message'
  | 'consent'
  | 'choice'
  | 'unknown'

const ROLE_PATTERNS: [FieldRole, RegExp][] = [
  // A ordem importa: "first name" tem de ser testado antes de "name".
  ['first_name', /(first[-_ ]?name|primeiro[-_ ]?nome|fname|nome[-_ ]?proprio|nome[-_ ]?próprio)/i],
  ['last_name', /(last[-_ ]?name|surname|apelido|ultimo[-_ ]?nome|último[-_ ]?nome|lname)/i],
  ['email', /(e-?mail|correio)/i],
  ['phone', /(phone|tel|telefone|telemovel|telemóvel|contacto[-_ ]?tel|mobile|whatsapp)/i],
  ['company', /(company|empresa|organiza|negocio|negócio|business)/i],
  ['subject', /(subject|assunto|titulo|título|motivo)/i],
  ['message', /(message|mensagem|comment|comentario|comentário|duvida|dúvida|descricao|descrição|detalhe)/i],
  ['consent', /(consent|rgpd|gdpr|privac|politica|política|termos|terms|aceito|accept|autorizo)/i],
  ['name', /(name|nome)/i],
]

/** Deduz o papel de um campo a partir do nome, id, placeholder e label. */
export function inferFieldRole(field: DiscoveredField): FieldRole {
  if (field.type === 'email') return 'email'
  if (field.type === 'tel') return 'phone'
  if (field.type === 'textarea') return 'message'
  if (field.type === 'checkbox' || field.type === 'radio') {
    const text = `${field.name} ${field.id ?? ''} ${field.label ?? ''} ${field.ariaLabel ?? ''}`
    return ROLE_PATTERNS.find(([role]) => role === 'consent')?.[1].test(text) ? 'consent' : 'choice'
  }
  if (field.type === 'select') return 'choice'

  // O `autocomplete` vem primeiro porque é declarado pelo autor para dizer o
  // papel do campo — `given-name`, `tel`, `organization` — e por isso é mais
  // fiável do que adivinhar pelo nome. Num formulário sem `name` é o único
  // sinal explícito que resta.
  const text = [
    field.autocomplete,
    field.name,
    field.id,
    field.placeholder,
    field.label,
    field.ariaLabel,
  ]
    .filter(Boolean)
    .join(' ')
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(text)) return role
  }
  return 'unknown'
}

export interface FieldFill {
  field: DiscoveredField
  role: FieldRole
  /** Valor a escrever. `null` significa marcar (checkbox) ou escolher (select). */
  value: string | null
  action: 'fill' | 'check' | 'select'
}

export interface FillPlan {
  fills: FieldFill[]
  /** Campos obrigatórios cujo preenchimento não foi possível deduzir. */
  unresolvedRequired: DiscoveredField[]
}

/**
 * Plano de preenchimento de um formulário.
 *
 * Campos obrigatórios que não se conseguem deduzir são devolvidos em vez de
 * adivinhados: é preferível pedir configuração manual a submeter lixo no CRM
 * do cliente.
 */
export function buildFillPlan(form: DiscoveredForm, canary: CanaryIdentity): FillPlan {
  const fills: FieldFill[] = []
  const unresolvedRequired: DiscoveredField[] = []

  for (const field of form.fields) {
    // Campos escondidos costumam ser nonces e tokens do próprio formulário:
    // escrever neles parte a submissão.
    if (field.type === 'hidden') continue

    const role = inferFieldRole(field)

    switch (role) {
      case 'email':
        fills.push({ field, role, value: canary.address, action: 'fill' })
        break
      case 'name':
        fills.push({ field, role, value: canary.name, action: 'fill' })
        break
      case 'first_name':
        fills.push({ field, role, value: 'Jellycare', action: 'fill' })
        break
      case 'last_name':
        fills.push({ field, role, value: 'Monitor', action: 'fill' })
        break
      case 'phone':
        fills.push({ field, role, value: canary.phone, action: 'fill' })
        break
      case 'company':
        fills.push({ field, role, value: canary.company, action: 'fill' })
        break
      case 'subject':
        fills.push({ field, role, value: canary.subject, action: 'fill' })
        break
      case 'message':
        fills.push({ field, role, value: canary.message, action: 'fill' })
        break
      case 'consent':
        // Marcar o consentimento é o que um visitante real faria; sem isto a
        // submissão é rejeitada e reportaríamos um falso positivo.
        if (field.required) fills.push({ field, role, value: null, action: 'check' })
        break
      case 'choice': {
        if (!field.required) break
        const first = field.options?.[0]
        if (first) fills.push({ field, role, value: first, action: 'select' })
        else if (field.type === 'radio') fills.push({ field, role, value: null, action: 'check' })
        else unresolvedRequired.push(field)
        break
      }
      default:
        if (field.required) unresolvedRequired.push(field)
    }
  }

  return { fills, unresolvedRequired }
}
