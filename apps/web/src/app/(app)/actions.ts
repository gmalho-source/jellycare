'use server'

import { CHECK_REGISTRY, buildChallenge, verifyOwnership } from '@jellycare/checks'
import { revokeSession, schema } from '@jellycare/db'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { SESSION_COOKIE, assertMembership, canManage, requireUser } from '@/lib/session'

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
    Object.values(CHECK_REGISTRY).map((check) => ({
      siteId,
      checkType: check.definition.type,
      intervalMinutes: check.definition.defaultIntervalMinutes,
      enabled: true,
      config: input.expectedContent && check.definition.type === 'uptime'
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
