import { schema } from '@jellycare/db'
import { and, desc, eq } from 'drizzle-orm'
import type { EmailMontado } from './aviso-email'
import { getDb } from './db'

export interface AvisoRegistado {
  id: string
  recipients: string[]
  subject: string
  createdAt: Date
  sentAt: Date | null
  error: string | null
  sentByEmail: string | null
}

/** Os avisos já tentados sobre um problema, do mais recente para o mais antigo. */
export async function lerAvisos(findingId: string): Promise<AvisoRegistado[]> {
  return getDb()
    .select({
      id: schema.clientNotifications.id,
      recipients: schema.clientNotifications.recipients,
      subject: schema.clientNotifications.subject,
      createdAt: schema.clientNotifications.createdAt,
      sentAt: schema.clientNotifications.sentAt,
      error: schema.clientNotifications.error,
      sentByEmail: schema.users.email,
    })
    .from(schema.clientNotifications)
    .leftJoin(schema.users, eq(schema.users.id, schema.clientNotifications.sentBy))
    .where(eq(schema.clientNotifications.findingId, findingId))
    .orderBy(desc(schema.clientNotifications.createdAt))
}

export interface SugestaoDeDestinatario {
  email: string
  /** Tem acesso ao portal do cliente. */
  acesso: boolean
  /** Recebe o relatório mensal deste site. */
  relatorios: boolean
}

/**
 * A quem faz sentido enviar um aviso sobre este site.
 *
 * Duas origens, que não são a mesma coisa: quem tem conta no portal do cliente
 * e quem recebe o relatório mensal. Muitas vezes coincidem, e às vezes não —
 * o relatório vai para a direção e quem entra no portal é quem trata do site.
 * A lista diz de onde vem cada um para quem revê poder escolher.
 *
 * Só os papéis de cliente. A equipa da Jelly também pertence à organização, e
 * mandar-lhe um aviso sobre o problema que ela própria está a tratar seria
 * ruído na caixa de quem menos precisa dele.
 */
export async function sugestoesDeDestinatarios(
  siteId: string,
  organizationId: string,
): Promise<SugestaoDeDestinatario[]> {
  const db = getDb()
  const [site, contas] = await Promise.all([
    db
      .select({ recipients: schema.sites.reportRecipients })
      .from(schema.sites)
      .where(eq(schema.sites.id, siteId))
      .limit(1),
    db
      .select({ email: schema.users.email })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(
        and(
          eq(schema.memberships.organizationId, organizationId),
          eq(schema.memberships.role, 'client'),
        ),
      ),
  ])

  const porEmail = new Map<string, SugestaoDeDestinatario>()
  const juntar = (email: string, origem: 'acesso' | 'relatorios') => {
    const chave = email.trim().toLowerCase()
    if (!chave) return
    const atual = porEmail.get(chave) ?? { email: chave, acesso: false, relatorios: false }
    atual[origem] = true
    porEmail.set(chave, atual)
  }
  for (const email of site[0]?.recipients ?? []) juntar(email, 'relatorios')
  for (const conta of contas) juntar(conta.email, 'acesso')

  return [...porEmail.values()].sort((a, b) => a.email.localeCompare(b.email))
}

export interface EnvioPeloResend {
  para: string[]
  responderPara: string
  email: EmailMontado
}

/**
 * Entrega um email pelo Resend.
 *
 * Separado do registo para se poder provar a forma do pedido sem base de
 * dados. O `reply_to` é quem reviu e enviou: a resposta de um cliente a um
 * aviso sobre o site dele tem de chegar a uma pessoa, e não a um endereço de
 * envio que ninguém lê.
 */
export async function enviarPeloResend(
  envio: EnvioPeloResend,
  opcoes: { apiKey: string | undefined; de: string; fetchImpl?: typeof fetch },
): Promise<void> {
  if (!opcoes.apiKey) throw new Error('RESEND_API_KEY não está configurado nesta aplicação.')

  const resposta = await (opcoes.fetchImpl ?? fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opcoes.apiKey}`,
    },
    body: JSON.stringify({
      from: opcoes.de,
      to: envio.para,
      reply_to: envio.responderPara,
      subject: envio.email.assunto,
      html: envio.email.html,
      text: envio.email.texto,
    }),
  })

  if (!resposta.ok) {
    throw new Error(`O Resend respondeu ${resposta.status}: ${await resposta.text()}`)
  }
}

/**
 * Regista e envia um aviso já revisto.
 *
 * A linha é escrita **antes** de tentar enviar e atualizada depois. Ao
 * contrário, uma queda entre o envio e o registo deixava um email na caixa do
 * cliente de que a Jelly não tinha registo nenhum — e é exatamente o que este
 * registo existe para impedir.
 *
 * Uma falha fica gravada com o erro, e não só devolvida: um aviso que não saiu
 * é precisamente aquele de que ninguém se lembra de ter tentado enviar.
 */
export async function registarEEnviar(options: {
  findingId: string
  userId: string
  destinatarios: string[]
  responderPara: string
  email: EmailMontado
  corpo: string
  fetchImpl?: typeof fetch
}): Promise<{ ok: true; id: string } | { ok: false; id: string; erro: string }> {
  const db = getDb()

  const [linha] = await db
    .insert(schema.clientNotifications)
    .values({
      findingId: options.findingId,
      sentBy: options.userId,
      recipients: options.destinatarios,
      subject: options.email.assunto,
      body: options.corpo,
    })
    .returning({ id: schema.clientNotifications.id })
  const id = linha!.id

  try {
    await enviarPeloResend(
      { para: options.destinatarios, responderPara: options.responderPara, email: options.email },
      {
        apiKey: process.env.RESEND_API_KEY,
        de: process.env.NOTICE_FROM_EMAIL ?? 'Jelly <avisos@jellycare.pt>',
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      },
    )
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro)
    await db
      .update(schema.clientNotifications)
      .set({ error: mensagem })
      .where(eq(schema.clientNotifications.id, id))
    return { ok: false, id, erro: mensagem }
  }

  await db
    .update(schema.clientNotifications)
    .set({ sentAt: new Date() })
    .where(eq(schema.clientNotifications.id, id))
  return { ok: true, id }
}
