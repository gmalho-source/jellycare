'use server'

import {
  EquipaSemNinguemError,
  acrescentarAEquipa,
  acrescentarContacto,
  alterarContacto,
  apagarContacto,
  criarOrganizacao,
  moverSite,
  renomearOrganizacao,
  retirarDaEquipa,
  schema,
} from '@jellycare/db'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { sendAccessEmail } from '@/lib/email-acesso'
import { assertMembership, canManage, requireStaff, requireUser } from '@/lib/session'

export interface EstadoDoFormulario {
  message?: string
  error?: string
}

const primeiroErro = (resultado: z.SafeParseError<unknown>) =>
  resultado.error.issues[0]?.message ?? 'Dados inválidos.'

/* -------------------------------------------------------------------------- */
/* Organizações                                                               */
/* -------------------------------------------------------------------------- */

const nomeSchema = z
  .string()
  .trim()
  .min(2, 'Indique o nome da organização.')
  .max(120, 'O nome é demasiado comprido.')

/** Só a Equipa Jelly cria clientes: é a Jelly quem decide com quem trabalha. */
export async function criarOrganizacaoAction(
  _anterior: EstadoDoFormulario,
  formData: FormData,
): Promise<EstadoDoFormulario> {
  await requireStaff()
  const nome = nomeSchema.safeParse(formData.get('name'))
  if (!nome.success) return { error: primeiroErro(nome) }

  const criada = await criarOrganizacao(getDb(), nome.data)
  revalidatePath('/organizacoes')
  redirect(`/organizacoes/${criada.id}`)
}

export async function renomearOrganizacaoAction(
  _anterior: EstadoDoFormulario,
  formData: FormData,
): Promise<EstadoDoFormulario> {
  await requireStaff()
  const dados = z
    .object({ organizationId: z.string().uuid(), name: nomeSchema })
    .safeParse({ organizationId: formData.get('organizationId'), name: formData.get('name') })
  if (!dados.success) return { error: primeiroErro(dados) }

  await renomearOrganizacao(getDb(), dados.data.organizationId, dados.data.name)
  revalidatePath(`/organizacoes/${dados.data.organizationId}`)
  revalidatePath('/organizacoes')
  return { message: 'Nome guardado.' }
}

/**
 * Muda um site para outra organização.
 *
 * Só a Equipa Jelly: é a ação que decide que cliente vê que site no portal.
 */
export async function moverSiteAction(
  _anterior: EstadoDoFormulario,
  formData: FormData,
): Promise<EstadoDoFormulario> {
  await requireStaff()
  const dados = z
    .object({ siteId: z.string().uuid(), organizationId: z.string().uuid('Escolha a organização.') })
    .safeParse({ siteId: formData.get('siteId'), organizationId: formData.get('organizationId') })
  if (!dados.success) return { error: primeiroErro(dados) }

  const db = getDb()
  const [destino] = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, dados.data.organizationId))
    .limit(1)
  if (!destino) return { error: 'Organização não encontrada.' }

  await moverSite(db, dados.data.siteId, destino.id)
  revalidatePath(`/sites/${dados.data.siteId}`, 'layout')
  revalidatePath('/organizacoes', 'layout')
  return { message: `O site passou para ${destino.name}.` }
}

/* -------------------------------------------------------------------------- */
/* Contactos                                                                  */
/* -------------------------------------------------------------------------- */

const opcional = (maximo: number, mensagem: string) =>
  z
    .string()
    .trim()
    .max(maximo, mensagem)
    .optional()
    .transform((valor) => (valor ? valor : null))

const contactoSchema = z
  .object({
    organizationId: z.string().uuid(),
    contactoId: z.string().uuid().optional(),
    name: z.string().trim().min(1, 'Indique o nome do contacto.').max(120, 'O nome é demasiado comprido.'),
    jobTitle: opcional(120, 'A função é demasiado comprida.'),
    phone: opcional(40, 'O telefone é demasiado comprido.').refine(
      (valor) => valor === null || /^[+\d][\d\s().-]{5,}$/.test(valor),
      'Indique um telefone válido, por exemplo +351 912 345 678.',
    ),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .transform((valor) => (valor ? valor : null))
      .refine((valor) => valor === null || z.string().email().safeParse(valor).success, 'Indique um email válido.'),
    receivesReports: z.boolean(),
  })
  .refine((dados) => !dados.receivesReports || dados.email !== null, {
    message: 'Para receber o relatório mensal, o contacto precisa de email.',
  })

const textoDe = (formData: FormData, campo: string) => {
  const valor = formData.get(campo)
  return typeof valor === 'string' && valor !== '' ? valor : undefined
}

/**
 * Acrescenta ou altera um contacto.
 *
 * Quem gere a organização gere os contactos dela. Um cliente vê o portal e
 * não esta ficha.
 */
export async function guardarContactoAction(
  _anterior: EstadoDoFormulario,
  formData: FormData,
): Promise<EstadoDoFormulario> {
  const user = await requireUser()
  const dados = contactoSchema.safeParse({
    organizationId: formData.get('organizationId'),
    contactoId: textoDe(formData, 'contactoId'),
    name: formData.get('name') ?? '',
    jobTitle: textoDe(formData, 'jobTitle'),
    phone: textoDe(formData, 'phone'),
    email: textoDe(formData, 'email'),
    receivesReports: formData.get('receivesReports') === 'on',
  })
  if (!dados.success) return { error: primeiroErro(dados) }

  assertMembership(user, dados.data.organizationId)
  if (!canManage(user, dados.data.organizationId)) {
    return { error: 'Não tem permissão para gerir os contactos desta organização.' }
  }

  const { organizationId, contactoId, ...contacto } = dados.data
  const db = getDb()
  if (contactoId) await alterarContacto(db, organizationId, contactoId, contacto)
  else await acrescentarContacto(db, organizationId, contacto)

  revalidatePath(`/organizacoes/${organizationId}`)
  return { message: contactoId ? 'Contacto guardado.' : `${contacto.name} acrescentado aos contactos.` }
}

export async function apagarContactoAction(formData: FormData): Promise<void> {
  const user = await requireUser()
  const dados = z
    .object({ organizationId: z.string().uuid(), contactoId: z.string().uuid() })
    .safeParse({ organizationId: formData.get('organizationId'), contactoId: formData.get('contactoId') })
  if (!dados.success) return

  assertMembership(user, dados.data.organizationId)
  if (!canManage(user, dados.data.organizationId)) return

  await apagarContacto(getDb(), dados.data.organizationId, dados.data.contactoId)
  revalidatePath(`/organizacoes/${dados.data.organizationId}`)
}

/* -------------------------------------------------------------------------- */
/* Equipa Jelly                                                               */
/* -------------------------------------------------------------------------- */

const emailSchema = z.string().trim().toLowerCase().email('Indique um endereço de email válido.')

export async function acrescentarEquipaAction(
  _anterior: EstadoDoFormulario,
  formData: FormData,
): Promise<EstadoDoFormulario> {
  await requireStaff()
  const email = emailSchema.safeParse(formData.get('email'))
  if (!email.success) return { error: primeiroErro(email) }

  const { entrou } = await acrescentarAEquipa(getDb(), email.data)
  if (entrou) await sendAccessEmail(email.data, 'staff')

  revalidatePath('/equipa')
  return {
    message: entrou
      ? `${email.data} entrou na Equipa Jelly e foi avisado por email.`
      : `${email.data} já fazia parte da Equipa Jelly.`,
  }
}

export async function retirarEquipaAction(
  _anterior: EstadoDoFormulario,
  formData: FormData,
): Promise<EstadoDoFormulario> {
  const user = await requireStaff()
  const userId = z.string().uuid().safeParse(formData.get('userId'))
  if (!userId.success) return { error: 'Pessoa inválida.' }
  // Tirar-se a si próprio fecha a página Equipa no próprio pedido. Faz-se
  // pela mão de outra pessoa da equipa.
  if (userId.data === user.id) return { error: 'Não se pode retirar a si próprio da equipa.' }

  try {
    await retirarDaEquipa(getDb(), userId.data)
  } catch (error) {
    if (error instanceof EquipaSemNinguemError) return { error: error.message }
    throw error
  }

  revalidatePath('/equipa')
  return { message: 'Retirado da Equipa Jelly.' }
}
