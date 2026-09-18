'use server'

import { buildChallenge, verifyOwnership } from '@jellycare/checks'
import { grantAccess, revokeAccess, revokeSession, schema } from '@jellycare/db'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { appOrigin } from '@/lib/app-url'
import { ALL_CHECKS } from '@/lib/checks'
import { getDb } from '@/lib/db'
import {
  SESSION_COOKIE,
  assertMembership,
  canGrantRole,
  canManage,
  requireUser,
} from '@/lib/session'

export async function signOut(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) await revokeSession(getDb(), token)
  store.delete(SESSION_COOKIE)
  redirect('/login')
}

const createSiteSchema = z.object({
  organizationId: z.string().uuid('Escolha a organização.'),
  label: z.string().trim().min(1, 'Dê um nome ao site.').max(120),
  url: z
    .string()
    .trim()
    .min(1, 'Indique o endereço do site.')
    .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .refine((value) => {
      try {
        const parsed = new URL(value)
        return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      } catch {
        return false
      }
    }, 'O endereço não é válido.'),
  method: z.enum(['dns_txt', 'http_file']),
  expectedContent: z.string().trim().max(200).optional(),
})

export type ActionState = { error?: string; message?: string }

/**
 * Cria um site e o respetivo desafio de verificação.
 *
 * O site nasce em `onboarding` e só o uptime corre até a propriedade do
 * domínio estar provada. Ver docs/riscos.md.
 */
export async function createSite(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()

  const parsed = createSiteSchema.safeParse({
    organizationId: formData.get('organizationId'),
    label: formData.get('label'),
    url: formData.get('url'),
    method: formData.get('method'),
    expectedContent: formData.get('expectedContent') || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  const input = parsed.data
  assertMembership(user, input.organizationId)
  if (!canManage(user, input.organizationId)) {
    return { error: 'Não tem permissão para adicionar sites.' }
  }

  const parsedUrl = new URL(input.url)
  // Guardado sem barra final, para que o URL seja idêntico em toda a parte e
  // os fingerprints dos findings se mantenham estáveis.
  const canonicalUrl = parsedUrl.origin
  const db = getDb()

  let siteId: string
  try {
    const [site] = await db
      .insert(schema.sites)
      .values({
        organizationId: input.organizationId,
        label: input.label,
        url: canonicalUrl,
        hostname: parsedUrl.hostname,
        state: 'onboarding',
        ...(input.expectedContent ? { expectedContent: input.expectedContent } : {}),
      })
      .returning({ id: schema.sites.id })
    siteId = site!.id
  } catch {
    return { error: 'Não foi possível criar o site. Verifique se já existe.' }
  }

  const challenge = buildChallenge(input.method, parsedUrl.hostname)
  await db.insert(schema.siteVerifications).values({
    siteId,
    method: challenge.method,
    token: challenge.token,
    state: 'pending',
  })

  // Todos os checks ficam configurados desde já; o runner é que recusa os que
  // exigem verificação enquanto ela não estiver feita.
  await db.insert(schema.checkConfigs).values(
    ALL_CHECKS.map((check) => ({
      siteId,
      checkType: check.type,
      intervalMinutes: check.defaultIntervalMinutes,
      enabled: true,
      config:
        input.expectedContent && check.type === 'uptime'
          ? { expectedContent: input.expectedContent }
          : {},
    })),
  )

  redirect(`/sites/${siteId}`)
}

/** Executa a verificação de propriedade e ativa o site quando passa. */
export async function checkVerification(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const siteId = z.string().uuid().safeParse(formData.get('siteId'))
  if (!siteId.success) return { error: 'Site inválido.' }

  const db = getDb()
  const sites = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId.data))
    .limit(1)
  const site = sites[0]
  if (!site) return { error: 'Site não encontrado.' }

  assertMembership(user, site.organizationId)
  if (!canManage(user, site.organizationId)) {
    return { error: 'Não tem permissão para verificar este site.' }
  }

  const pending = await db
    .select()
    .from(schema.siteVerifications)
    .where(
      and(
        eq(schema.siteVerifications.siteId, site.id),
        eq(schema.siteVerifications.state, 'pending'),
      ),
    )
    .limit(1)

  const verification = pending[0]
  if (!verification) return { error: 'Não há verificação pendente para este site.' }

  const result = await verifyOwnership({
    method: verification.method,
    hostname: site.hostname,
    siteUrl: site.url,
    token: verification.token,
  })

  const now = new Date()
  await db
    .update(schema.siteVerifications)
    .set({
      lastCheckedAt: now,
      ...(result.verified ? { state: 'verified' as const, verifiedAt: now } : {}),
    })
    .where(eq(schema.siteVerifications.id, verification.id))

  if (result.verified && site.state === 'onboarding') {
    await db.update(schema.sites).set({ state: 'active' }).where(eq(schema.sites.id, site.id))
  }

  revalidatePath(`/sites/${site.id}`)
  return result.verified ? { message: result.detail } : { error: result.detail }
}

const findingActionSchema = z.object({
  findingId: z.string().uuid(),
  state: z.enum(['acknowledged', 'ignored', 'open']),
})

/** Reconhece ou silencia um finding. */
export async function updateFindingState(formData: FormData): Promise<void> {
  const user = await requireUser()
  const parsed = findingActionSchema.safeParse({
    findingId: formData.get('findingId'),
    state: formData.get('state'),
  })
  if (!parsed.success) return

  const db = getDb()
  const rows = await db
    .select({ siteId: schema.findings.siteId, organizationId: schema.sites.organizationId })
    .from(schema.findings)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.findings.siteId))
    .where(eq(schema.findings.id, parsed.data.findingId))
    .limit(1)

  const finding = rows[0]
  if (!finding) return

  assertMembership(user, finding.organizationId)
  if (!canManage(user, finding.organizationId)) return

  await db
    .update(schema.findings)
    .set({
      state: parsed.data.state,
      acknowledgedBy: user.id,
      acknowledgedAt: new Date(),
    })
    .where(eq(schema.findings.id, parsed.data.findingId))

  revalidatePath(`/sites/${finding.siteId}`)
}

const grantAccessSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email('Indique um endereço de email válido.'),
  role: z.enum(['admin', 'member', 'client']),
})

export interface AccessState {
  message?: string
  error?: string
}

/**
 * Dá a alguém acesso à organização e avisa-o por email.
 *
 * O email não leva ligação de entrada: essa é válida quinze minutos e só pode
 * ser usada uma vez, o que faz dela uma péssima coisa para pôr num convite que
 * pode ser aberto no dia seguinte. A mensagem diz que o acesso existe e manda
 * a pessoa pedir a sua própria ligação.
 */
export async function grantAccessAction(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const user = await requireUser()

  const parsed = grantAccessSchema.safeParse({
    organizationId: formData.get('organizationId'),
    email: formData.get('email'),
    role: formData.get('role'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  assertMembership(user, parsed.data.organizationId)
  if (!canManage(user, parsed.data.organizationId)) {
    return { error: 'Não tem permissão para gerir acessos nesta organização.' }
  }
  if (!canGrantRole(user, parsed.data.organizationId, parsed.data.role)) {
    return { error: 'Não pode conceder um papel com mais permissões do que o seu.' }
  }

  const granted = await grantAccess(getDb(), parsed.data)

  if (granted.created) {
    await sendAccessEmail(parsed.data.email, parsed.data.role)
  }

  revalidatePath('/sites')
  return {
    message: granted.created
      ? `${parsed.data.email} passou a ter acesso e foi avisado por email.`
      : `${parsed.data.email} já tinha acesso; o papel foi atualizado.`,
  }
}

const revokeAccessSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
})

export async function revokeAccessAction(formData: FormData): Promise<void> {
  const user = await requireUser()

  const parsed = revokeAccessSchema.safeParse({
    organizationId: formData.get('organizationId'),
    userId: formData.get('userId'),
  })
  if (!parsed.success) return

  assertMembership(user, parsed.data.organizationId)
  if (!canManage(user, parsed.data.organizationId)) return
  // Tirar o acesso a si próprio deixaria a organização sem quem a gere, e a
  // recuperação passaria pela base de dados.
  if (parsed.data.userId === user.id) return

  await revokeAccess(getDb(), parsed.data.organizationId, parsed.data.userId)
  revalidatePath('/sites')
}

const ROLE_DESCRIPTION: Record<string, string> = {
  admin: 'gestão completa da conta',
  member: 'acesso de equipa ao painel',
  client: 'acesso ao portal, só de leitura',
}

async function sendAccessEmail(to: string, role: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const destino = role === 'client' ? `${appOrigin()}/portal` : appOrigin()

  const texto =
    'A Jelly deu-lhe acesso à Jellycare, onde acompanhamos a saúde dos sites que mantemos ' +
    `(${ROLE_DESCRIPTION[role] ?? 'acesso'}).\n\n` +
    `Para entrar, vá a ${appOrigin()}/login e indique este endereço de email. Receberá uma ` +
    'ligação de entrada válida durante quinze minutos. Não há palavra-passe para memorizar ' +
    'nem para perder.\n\n' +
    `Depois de entrar, encontra tudo em ${destino}.`

  if (!apiKey) {
    console.info(`[jellycare] aviso de acesso para ${to}: ${destino}`)
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: process.env.ALERT_FROM_EMAIL ?? 'Jellycare <alertas@jellycare.pt>',
      to: [to],
      subject: 'Tem acesso à Jellycare',
      text: texto,
    }),
  })

  if (!response.ok) {
    console.error(`[jellycare] falha ao avisar ${to} do acesso: ${response.status}`)
  }
}

const resendAccessSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
})

/**
 * Repete o aviso de acesso a quem já o tem.
 *
 * O aviso original só sai quando o acesso é criado. Sem esta ação, uma
 * mensagem apagada ou apanhada pelo spam obrigava a retirar o acesso e a
 * voltar a dá-lo só para o email sair outra vez.
 *
 * O email e o papel vêm da base de dados e não do formulário: quem carrega no
 * botão está a dizer "avisa esta pessoa outra vez", não a escolher para onde
 * a mensagem vai.
 */
export async function resendAccessAction(
  _previous: AccessState,
  formData: FormData,
): Promise<AccessState> {
  const user = await requireUser()

  const parsed = resendAccessSchema.safeParse({
    organizationId: formData.get('organizationId'),
    userId: formData.get('userId'),
  })
  if (!parsed.success) return { error: 'Dados inválidos.' }

  assertMembership(user, parsed.data.organizationId)
  if (!canManage(user, parsed.data.organizationId)) {
    return { error: 'Não tem permissão para gerir acessos nesta organização.' }
  }

  const rows = await getDb()
    .select({ email: schema.users.email, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.organizationId, parsed.data.organizationId),
        eq(schema.memberships.userId, parsed.data.userId),
      ),
    )
    .limit(1)

  const member = rows[0]
  if (!member) return { error: 'Essa pessoa já não tem acesso a esta organização.' }

  await sendAccessEmail(member.email, member.role)

  return { message: `Aviso reenviado para ${member.email}.` }
}
