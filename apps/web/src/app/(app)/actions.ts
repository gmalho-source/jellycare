'use server'

import { buildChallenge, verifyOwnershipAny } from '@jellycare/checks'
import {
  addMaintenanceWindow,
  grantAccess,
  parseFormTestUrls,
  parseSiteSettings,
  requestReport,
  revokeAccess,
  revokeSession,
  removeMaintenanceWindow,
  schema,
  setNegotiatedDpaRef,
} from '@jellycare/db'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { appOrigin } from '@/lib/app-url'
import {
  ALL_CHECKS,
  MAX_CHECK_INTERVAL_MINUTES,
  MIN_CHECK_INTERVAL_MINUTES,
} from '@/lib/checks'
import { getDb } from '@/lib/db'
import { listUmbrellaProjects } from '@/lib/umbrella'
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

  // Tenta as duas vias com o mesmo token. Quem não controla o DNS do cliente
  // só descobre que o TXT não é viável depois de tentar, e nessa altura não
  // deve ter de trocar de método em lado nenhum: publica o ficheiro e carrega
  // no mesmo botão.
  const result = await verifyOwnershipAny({
    hostname: site.hostname,
    siteUrl: site.url,
    token: verification.token,
  })

  const now = new Date()
  await db
    .update(schema.siteVerifications)
    .set({
      lastCheckedAt: now,
      // O método guardado passa a ser aquele por onde a prova entrou, e não o
      // que foi escolhido na criação. É o que ficou registado como verdade.
      ...(result.verified
        ? { state: 'verified' as const, verifiedAt: now, method: result.method }
        : {}),
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

const reportRequestSchema = z.object({
  siteId: z.string().uuid(),
  // Vazio significa "os destinatários configurados no site".
  recipient: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === '' || z.string().email().safeParse(value).success, {
      message: 'Indique um endereço de email válido, ou deixe vazio.',
    }),
})

export interface ReportRequestState {
  message?: string
  error?: string
}

/**
 * Pede o envio imediato do relatório do último mês completo.
 *
 * O dashboard não gera o PDF: não tem browser. Deixa o pedido na base de
 * dados e o worker, que tem, apanha-o em segundos. É por isso que a resposta
 * diz "a preparar" e não "enviado" — prometer o que ainda não aconteceu era
 * mentir a quem está a olhar para o ecrã.
 */
export async function requestReportAction(
  _previous: ReportRequestState,
  formData: FormData,
): Promise<ReportRequestState> {
  const user = await requireUser()

  const parsed = reportRequestSchema.safeParse({
    siteId: formData.get('siteId'),
    recipient: formData.get('recipient') ?? '',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  const rows = await getDb()
    .select({ organizationId: schema.sites.organizationId })
    .from(schema.sites)
    .where(eq(schema.sites.id, parsed.data.siteId))
    .limit(1)

  const site = rows[0]
  if (!site) return { error: 'Site não encontrado.' }

  assertMembership(user, site.organizationId)
  if (!canManage(user, site.organizationId)) {
    return { error: 'Não tem permissão para enviar relatórios deste site.' }
  }

  const { created } = await requestReport(getDb(), {
    siteId: parsed.data.siteId,
    requestedBy: user.id,
    ...(parsed.data.recipient ? { recipients: [parsed.data.recipient] } : {}),
  })

  revalidatePath(`/sites/${parsed.data.siteId}`)

  if (!created) {
    return { message: 'Já havia um pedido a decorrer para este site; não foi criado outro.' }
  }

  return {
    message: parsed.data.recipient
      ? `A preparar o relatório para ${parsed.data.recipient}. Demora menos de um minuto.`
      : 'A preparar o relatório para os destinatários configurados. Demora menos de um minuto.',
  }
}

export interface FormTestUrlsState {
  message?: string
  error?: string
  /** O que foi recusado, para o painel poder dizer o quê e porquê. */
  rejected?: { input: string; reason: string }[]
}

/**
 * Declara as páginas onde os formulários podem ser testados.
 *
 * O teste de formulários escreve em campos e carrega em botões no site de um
 * cliente. Deixar a descoberta automática decidir onde era um erro: tanto
 * submetia o que ninguém queria submetido como ignorava o único formulário
 * que interessava. A decisão passa a ser de quem responde pelo site.
 */
export async function setFormTestUrlsAction(
  _previous: FormTestUrlsState,
  formData: FormData,
): Promise<FormTestUrlsState> {
  const user = await requireUser()

  const siteId = String(formData.get('siteId') ?? '')
  if (!siteId) return { error: 'Site em falta.' }

  const rows = await getDb()
    .select({ organizationId: schema.sites.organizationId, url: schema.sites.url })
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId))
    .limit(1)

  const site = rows[0]
  if (!site) return { error: 'Site não encontrado.' }

  assertMembership(user, site.organizationId)
  if (!canManage(user, site.organizationId)) {
    return { error: 'Não tem permissão para configurar este site.' }
  }

  const inputs = String(formData.get('urls') ?? '')
    .split('\n')
    .map((line) => line.trim())

  const { urls, rejected } = parseFormTestUrls(inputs, site.url)

  await getDb()
    .update(schema.sites)
    .set({ formTestUrls: urls })
    .where(eq(schema.sites.id, siteId))

  revalidatePath(`/sites/${siteId}`)

  const base =
    urls.length === 0
      ? 'Nenhuma página declarada: o teste de formulários não vai correr neste site.'
      : `${urls.length} ${urls.length === 1 ? 'página declarada' : 'páginas declaradas'}. O teste corre no próximo ciclo.`

  return rejected.length > 0 ? { message: base, rejected } : { message: base }
}

export interface ConnectorState {
  message?: string
  error?: string
}

/**
 * Liga um site a um projeto da WP Umbrella, ou desliga-o.
 *
 * A ligação é manual e não por correspondência automática de hostname. Um
 * site ligado ao projeto errado faz-nos reportar as vulnerabilidades de um
 * cliente a outro, e um `base_url` parecido chega para isso acontecer. O
 * administrador escolhe da lista, que traz o endereço de cada projeto para
 * ele confirmar.
 */
export async function linkUmbrellaProjectAction(
  _previous: ConnectorState,
  formData: FormData,
): Promise<ConnectorState> {
  const user = await requireUser()

  const siteId = String(formData.get('siteId') ?? '')
  const projectId = String(formData.get('projectId') ?? '').trim()

  if (!siteId) return { error: 'Site em falta.' }

  const rows = await getDb()
    .select({ organizationId: schema.sites.organizationId })
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId))
    .limit(1)

  const site = rows[0]
  if (!site) return { error: 'Site não encontrado.' }

  assertMembership(user, site.organizationId)
  if (!canManage(user, site.organizationId)) {
    return { error: 'Não tem permissão para configurar este site.' }
  }

  if (!projectId) {
    await getDb()
      .delete(schema.connectors)
      .where(and(eq(schema.connectors.siteId, siteId), eq(schema.connectors.type, 'wp_umbrella')))

    // O inventário vai atrás: deixámos de ter fonte para ele, e mostrar um
    // retrato que já ninguém atualiza é pior do que não mostrar nada.
    await getDb().delete(schema.wpComponents).where(eq(schema.wpComponents.siteId, siteId))

    revalidatePath(`/sites/${siteId}`)
    return { message: 'Ligação removida. O inventário WordPress deixa de ser recolhido.' }
  }

  // O identificador é confrontado com a lista real antes de ser gravado. Não
  // é cerimónia: um id que não existe faria o worker falhar todos os dias
  // contra um projeto fantasma, e o painel guardava-o sem se queixar.
  const { projects, unavailable } = await listUmbrellaProjects()
  if (unavailable) {
    return { error: `Não foi possível confirmar o projeto na WP Umbrella: ${unavailable}` }
  }

  const project = projects.find((candidate) => String(candidate.id) === projectId)
  if (!project) {
    return { error: 'Esse projeto não existe na conta da WP Umbrella.' }
  }

  await getDb()
    .insert(schema.connectors)
    .values({
      siteId,
      type: 'wp_umbrella',
      externalId: projectId,
      externalName: project.name,
    })
    .onConflictDoUpdate({
      target: [schema.connectors.siteId, schema.connectors.type],
      set: {
        externalId: projectId,
        externalName: project.name,
        lastError: null,
        lastSyncAt: null,
      },
    })

  revalidatePath(`/sites/${siteId}`)
  return { message: 'Site ligado. O inventário é recolhido no próximo ciclo.' }
}

export interface SiteSettingsState {
  message?: string
  error?: string
}

/** Lê o site e confirma que quem pede pode mexer nele. */
async function siteForManagement(siteId: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const rows = await getDb()
    .select({
      organizationId: schema.sites.organizationId,
      label: schema.sites.label,
      state: schema.sites.state,
    })
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId))
    .limit(1)

  const site = rows[0]
  if (!site) return { error: 'Site não encontrado.' as const }

  assertMembership(user, site.organizationId)
  if (!canManage(user, site.organizationId)) {
    return { error: 'Não tem permissão para configurar este site.' as const }
  }

  return { site }
}

/**
 * Definições do site.
 *
 * O URL não é editável. Mudar o endereço de um site já verificado invalida a
 * prova de propriedade e faz o histórico de disponibilidade passar a medir
 * outra coisa — quem muda mesmo de domínio tem um site novo, não um campo
 * diferente.
 */
export async function updateSiteSettingsAction(
  _previous: SiteSettingsState,
  formData: FormData,
): Promise<SiteSettingsState> {
  const user = await requireUser()
  const siteId = String(formData.get('siteId') ?? '')
  if (!siteId) return { error: 'Site em falta.' }

  const guard = await siteForManagement(siteId, user)
  if ('error' in guard) return { error: guard.error }

  const parsed = parseSiteSettings({
    label: String(formData.get('label') ?? ''),
    expectedContent: String(formData.get('expectedContent') ?? ''),
    recipients: String(formData.get('recipients') ?? ''),
    slaTarget: String(formData.get('slaTarget') ?? ''),
  })

  if (parsed.error || !parsed.settings) return { error: parsed.error ?? 'Dados inválidos.' }

  await getDb()
    .update(schema.sites)
    .set(parsed.settings)
    .where(eq(schema.sites.id, siteId))

  // O conteúdo esperado é lido pelo check de disponibilidade a partir da
  // configuração dele, e não da coluna do site. Mudar num sítio e não no
  // outro deixava o check a verificar uma palavra que já ninguém escolheu.
  await getDb()
    .update(schema.checkConfigs)
    .set({
      config: parsed.settings.expectedContent
        ? { expectedContent: parsed.settings.expectedContent }
        : {},
    })
    .where(and(eq(schema.checkConfigs.siteId, siteId), eq(schema.checkConfigs.checkType, 'uptime')))

  revalidatePath(`/sites/${siteId}`)
  revalidatePath('/')

  return {
    message:
      parsed.settings.reportRecipients.length === 0
        ? 'Guardado. Sem destinatários, o relatório mensal é gerado mas não é enviado a ninguém.'
        : 'Guardado.',
  }
}

/**
 * Arquiva ou reativa um site.
 *
 * Arquivar pára tudo — o agendador só olha para sites `active` — mas não
 * apaga nada. Um relatório que já foi para o cliente tem de continuar a bater
 * certo, e a política de retenção é que decide quando os dados saem.
 */
export async function setSiteStateAction(
  _previous: SiteSettingsState,
  formData: FormData,
): Promise<SiteSettingsState> {
  const user = await requireUser()
  const siteId = String(formData.get('siteId') ?? '')
  const target = String(formData.get('state') ?? '')

  if (target !== 'archived' && target !== 'active') return { error: 'Estado inválido.' }

  const guard = await siteForManagement(siteId, user)
  if ('error' in guard) return { error: guard.error }

  await getDb()
    .update(schema.sites)
    .set({ state: target })
    .where(eq(schema.sites.id, siteId))

  revalidatePath(`/sites/${siteId}`)
  revalidatePath('/')

  return {
    message:
      target === 'archived'
        ? 'Site arquivado. Deixa de ser verificado; o histórico fica.'
        : 'Site reativado. As verificações recomeçam no próximo ciclo.',
  }
}

/**
 * Apaga um site e tudo o que pende dele.
 *
 * Existe porque um cliente que sai tem direito a que os dados desapareçam, e
 * não conseguir cumprir isso seria um problema nosso e não dele. O `on delete
 * cascade` leva execuções, findings, formulários, submissões, relatórios e
 * inventário atrás.
 *
 * Exige o nome escrito à mão. Não é cerimónia: é a única barreira entre um
 * clique distraído e dados que não voltam.
 */
export async function deleteSiteAction(
  _previous: SiteSettingsState,
  formData: FormData,
): Promise<SiteSettingsState> {
  const user = await requireUser()
  const siteId = String(formData.get('siteId') ?? '')
  const confirmation = String(formData.get('confirmation') ?? '').trim()

  const guard = await siteForManagement(siteId, user)
  if ('error' in guard) return { error: guard.error }

  if (confirmation !== guard.site.label) {
    return { error: `Para apagar, escreva o nome do site exatamente: ${guard.site.label}` }
  }

  await getDb().delete(schema.sites).where(eq(schema.sites.id, siteId))

  revalidatePath('/')
  redirect('/')
}

/**
 * Registar — ou retirar — a referência ao DPA negociado em papel.
 *
 * Só quem gere a organização. Marcar isto desliga o fluxo online de
 * aceitação para o cliente, e é por isso que não é uma caixa que um cliente
 * possa marcar a si próprio: seria uma forma de dispensar o acordo sem
 * ninguém negociar nada.
 *
 * Campo vazio limpa a referência e devolve a organização ao fluxo normal.
 */
export async function setNegotiatedDpaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()

  const parsed = z
    .object({
      organizationId: z.string().uuid(),
      ref: z.string().trim().max(200).optional(),
    })
    .safeParse({
      organizationId: formData.get('organizationId'),
      ref: formData.get('ref') ?? undefined,
    })
  if (!parsed.success) return { error: 'Dados inválidos.' }

  assertMembership(user, parsed.data.organizationId)
  if (!canManage(user, parsed.data.organizationId)) {
    return { error: 'Sem permissão para alterar isto.' }
  }

  const ref = parsed.data.ref ?? ''
  await setNegotiatedDpaRef(getDb(), parsed.data.organizationId, ref.length > 0 ? ref : null)

  revalidatePath('/sites')
  return {
    message: ref.length > 0 ? 'Referência guardada.' : 'Referência removida.',
  }
}

/**
 * Declarar uma janela de manutenção, ou remover uma.
 *
 * Durante a janela os alertas não saem, mas as verificações continuam a
 * correr e os problemas continuam a ser registados — o worker respeita isto
 * desde o início. O que faltava era poder declará-la sem um `update` à mão.
 *
 * Os instantes chegam já em ISO com fuso, convertidos no browser. Receber a
 * hora escrita e interpretá-la aqui dava a hora do servidor, que corre em
 * UTC: quem marcasse as 22h em Lisboa ficava com uma janela às 23h, e quem a
 * marcasse no Dubai ficava três horas ao lado. O browser é o único sítio que
 * sabe em que fuso está quem escreveu.
 */
export async function setMaintenanceWindowAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()

  const parsed = z
    .object({
      siteId: z.string().uuid(),
      operacao: z.enum(['adicionar', 'remover']),
      start: z.string().min(1),
      end: z.string().min(1),
    })
    .safeParse({
      siteId: formData.get('siteId'),
      operacao: formData.get('operacao'),
      start: formData.get('start'),
      end: formData.get('end'),
    })
  if (!parsed.success) return { error: 'Indique o início e o fim da janela.' }

  const db = getDb()
  const rows = await db
    .select({
      organizationId: schema.sites.organizationId,
      maintenanceWindows: schema.sites.maintenanceWindows,
    })
    .from(schema.sites)
    .where(eq(schema.sites.id, parsed.data.siteId))
    .limit(1)

  const site = rows[0]
  if (!site) return { error: 'Site não encontrado.' }

  assertMembership(user, site.organizationId)
  if (!canManage(user, site.organizationId)) {
    return { error: 'Sem permissão para alterar isto.' }
  }

  if (parsed.data.operacao === 'remover') {
    const restantes = removeMaintenanceWindow(site.maintenanceWindows, {
      start: parsed.data.start,
      end: parsed.data.end,
    })
    await db
      .update(schema.sites)
      .set({ maintenanceWindows: restantes })
      .where(eq(schema.sites.id, parsed.data.siteId))

    revalidatePath(`/sites/${parsed.data.siteId}`)
    return { message: 'Janela removida.' }
  }

  const resultado = addMaintenanceWindow(site.maintenanceWindows, {
    start: parsed.data.start,
    end: parsed.data.end,
  })
  if (resultado.error) return { error: resultado.error }

  await db
    .update(schema.sites)
    .set({ maintenanceWindows: resultado.windows })
    .where(eq(schema.sites.id, parsed.data.siteId))

  revalidatePath(`/sites/${parsed.data.siteId}`)
  return { message: 'Janela declarada. Os alertas ficam suspensos nesse período.' }
}

/**
 * Ligar ou desligar a atualização automática de um site.
 *
 * É a única definição desta plataforma que a faz escrever no site de um
 * cliente, por isso é por site e só por quem gere. A janela de manutenção
 * continua a ser condição: ligada sem janela, não corre nada — e o painel
 * diz isso em vez de deixar a pessoa a achar que ficou tratado.
 */
export async function setAutoUpdateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()

  const parsed = z
    .object({ siteId: z.string().uuid(), enabled: z.enum(['on', 'off']) })
    .safeParse({ siteId: formData.get('siteId'), enabled: formData.get('enabled') })
  if (!parsed.success) return { error: 'Dados inválidos.' }

  const db = getDb()
  const rows = await db
    .select({
      organizationId: schema.sites.organizationId,
      maintenanceWindows: schema.sites.maintenanceWindows,
    })
    .from(schema.sites)
    .where(eq(schema.sites.id, parsed.data.siteId))
    .limit(1)

  const site = rows[0]
  if (!site) return { error: 'Site não encontrado.' }

  assertMembership(user, site.organizationId)
  if (!canManage(user, site.organizationId)) {
    return { error: 'Sem permissão para alterar isto.' }
  }

  const ligar = parsed.data.enabled === 'on'
  await db
    .update(schema.sites)
    .set({ autoUpdate: ligar })
    .where(eq(schema.sites.id, parsed.data.siteId))

  revalidatePath(`/sites/${parsed.data.siteId}`)

  if (!ligar) return { message: 'Atualização automática desligada.' }

  return {
    message:
      site.maintenanceWindows.length === 0
        ? 'Ligada — mas sem janela de manutenção declarada nada será atualizado. Declare uma acima.'
        : 'Ligada. As atualizações são aplicadas dentro da janela de manutenção.',
  }
}

/**
 * Mudar a periodicidade de uma verificação num site.
 *
 * Existe por causa de um caso concreto: o teste de formulários corre uma vez
 * por dia, e num cliente cujo funil de contactos é o negócio isso são até
 * vinte e quatro horas de pedidos perdidos antes de darmos por uma avaria de
 * entrega. Quem responde pelo site é que sabe se vale o custo.
 *
 * Os limites são largos mas existem: abaixo de cinco minutos é um pedido a
 * cada cinco minutos ao site de um cliente, e acima de um mês a verificação
 * está ligada só no papel.
 */
export async function setCheckIntervalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()

  const parsed = z
    .object({
      checkConfigId: z.string().uuid(),
      intervalMinutes: z.coerce
        .number()
        .int()
        .min(MIN_CHECK_INTERVAL_MINUTES, `Mínimo ${MIN_CHECK_INTERVAL_MINUTES} minutos.`)
        .max(MAX_CHECK_INTERVAL_MINUTES, 'Máximo 30 dias.'),
    })
    .safeParse({
      checkConfigId: formData.get('checkConfigId'),
      intervalMinutes: formData.get('intervalMinutes'),
    })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Periodicidade inválida.' }
  }

  const db = getDb()
  const rows = await db
    .select({
      siteId: schema.checkConfigs.siteId,
      organizationId: schema.sites.organizationId,
    })
    .from(schema.checkConfigs)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.checkConfigs.siteId))
    .where(eq(schema.checkConfigs.id, parsed.data.checkConfigId))
    .limit(1)

  const config = rows[0]
  if (!config) return { error: 'Verificação não encontrada.' }

  assertMembership(user, config.organizationId)
  if (!canManage(user, config.organizationId)) {
    return { error: 'Sem permissão para alterar isto.' }
  }

  // `nextRunAt` a nulo para a nova periodicidade valer já. Sem isto, baixar
  // de um dia para uma hora só tinha efeito depois de passar o dia inteiro
  // que já estava agendado — exatamente quando alguém a baixa por urgência.
  await db
    .update(schema.checkConfigs)
    .set({ intervalMinutes: parsed.data.intervalMinutes, nextRunAt: null })
    .where(eq(schema.checkConfigs.id, parsed.data.checkConfigId))

  revalidatePath(`/sites/${config.siteId}`)
  return { message: 'Periodicidade alterada. A próxima execução fica para já.' }
}
