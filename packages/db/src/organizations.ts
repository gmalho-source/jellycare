import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from './client.js'
import { memberships, organizationContacts, organizations, sites, users } from './schema.js'

/* -------------------------------------------------------------------------- */
/* Equipa Jelly                                                               */
/* -------------------------------------------------------------------------- */

export interface MembroDaEquipa {
  userId: string
  email: string
  name: string | null
}

export async function listarEquipa(db: Database): Promise<MembroDaEquipa[]> {
  return db
    .select({ userId: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.isStaff, true))
    .orderBy(asc(users.email))
}

/**
 * Põe alguém na Equipa Jelly, criando o utilizador se ainda não existir.
 *
 * Não emite credencial, como o `grantAccess`: a pessoa pede a sua própria
 * ligação de entrada. `entrou` diz se é novo na equipa, para só então se
 * mandar o aviso por email.
 */
export async function acrescentarAEquipa(db: Database, email: string): Promise<{ userId: string; entrou: boolean }> {
  const endereco = email.toLowerCase().trim()
  return db.transaction(async (tx) => {
    const [existente] = await tx
      .select({ id: users.id, isStaff: users.isStaff })
      .from(users)
      .where(eq(users.email, endereco))
      .limit(1)

    if (existente) {
      if (!existente.isStaff) await tx.update(users).set({ isStaff: true }).where(eq(users.id, existente.id))
      return { userId: existente.id, entrou: !existente.isStaff }
    }

    const [novo] = await tx.insert(users).values({ email: endereco, isStaff: true }).returning({ id: users.id })
    return { userId: novo!.id, entrou: true }
  })
}

export class EquipaSemNinguemError extends Error {
  constructor() {
    super('A Equipa Jelly não pode ficar sem ninguém.')
    this.name = 'EquipaSemNinguemError'
  }
}

/**
 * Tira alguém da Equipa Jelly.
 *
 * As pertenças que a pessoa tenha por si, numa organização concreta, ficam:
 * sair da equipa não é o mesmo que perder o acesso a um cliente com quem se
 * trabalha diretamente. Sem nenhuma, deixa de ver o que quer que seja.
 *
 * Nunca deixa a equipa vazia: sem ninguém, a página Equipa deixava de ter quem
 * a abrisse e a recuperação passava pela base de dados.
 */
export async function retirarDaEquipa(db: Database, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Bloqueia as linhas da equipa: dois pedidos em simultâneo a tirar os dois
    // últimos não podem passar ambos pela contagem.
    const equipa = await tx.select({ id: users.id }).from(users).where(eq(users.isStaff, true)).for('update')
    if (!equipa.some((membro) => membro.id === userId)) return
    if (equipa.length <= 1) throw new EquipaSemNinguemError()
    await tx.update(users).set({ isStaff: false }).where(eq(users.id, userId))
  })
}

/* -------------------------------------------------------------------------- */
/* Organizações                                                               */
/* -------------------------------------------------------------------------- */

export interface ResumoDeOrganizacao {
  id: string
  name: string
  sites: number
  contactos: number
  /** Pessoas com acesso próprio, sem contar a Equipa Jelly. */
  acessos: number
}

export async function listarOrganizacoes(db: Database, ids?: readonly string[]): Promise<ResumoDeOrganizacao[]> {
  const linhas = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      sites: sql<number>`(select count(*)::int from ${sites} where ${sites.organizationId} = ${organizations.id} and ${sites.state} <> 'archived')`,
      contactos: sql<number>`(select count(*)::int from ${organizationContacts} where ${organizationContacts.organizationId} = ${organizations.id})`,
      acessos: sql<number>`(select count(*)::int from ${memberships} where ${memberships.organizationId} = ${organizations.id})`,
    })
    .from(organizations)
    .orderBy(asc(organizations.name))
  return ids ? linhas.filter((linha) => ids.includes(linha.id)) : linhas
}

/** Um identificador legível e único a partir do nome: «Clínica Sorriso» → `clinica-sorriso`. */
export function slugDe(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'organizacao'
}

export async function criarOrganizacao(db: Database, nome: string): Promise<{ id: string; slug: string }> {
  const limpo = nome.trim()
  const base = slugDe(limpo)
  // Dois clientes com o mesmo nome são possíveis; dois `slug` iguais não.
  for (let tentativa = 1; tentativa <= 50; tentativa++) {
    const slug = tentativa === 1 ? base : `${base}-${tentativa}`
    const [criada] = await db
      .insert(organizations)
      .values({ name: limpo, slug })
      .onConflictDoNothing({ target: organizations.slug })
      .returning({ id: organizations.id, slug: organizations.slug })
    if (criada) return criada
  }
  throw new Error(`Não foi possível criar um identificador único para «${limpo}».`)
}

export async function renomearOrganizacao(db: Database, id: string, nome: string): Promise<void> {
  await db.update(organizations).set({ name: nome.trim() }).where(eq(organizations.id, id))
}

/**
 * Muda um site de organização.
 *
 * É o caminho para separar clientes que hoje estão todos na mesma: o papel de
 * cliente vale para a organização inteira, e um cliente com acesso ao portal
 * via os sites de toda a gente que estivesse com ele.
 */
export async function moverSite(db: Database, siteId: string, organizationId: string): Promise<void> {
  await db.update(sites).set({ organizationId }).where(eq(sites.id, siteId))
}

/* -------------------------------------------------------------------------- */
/* Contactos                                                                  */
/* -------------------------------------------------------------------------- */

export interface ContactoDaOrganizacao {
  id: string
  name: string
  jobTitle: string | null
  phone: string | null
  email: string | null
  receivesReports: boolean
}

export interface DadosDoContacto {
  name: string
  jobTitle?: string | null
  phone?: string | null
  email?: string | null
  receivesReports: boolean
}

const vazioParaNulo = (valor: string | null | undefined) => {
  const limpo = valor?.trim()
  return limpo ? limpo : null
}

function normalizarContacto(dados: DadosDoContacto) {
  return {
    name: dados.name.trim(),
    jobTitle: vazioParaNulo(dados.jobTitle),
    phone: vazioParaNulo(dados.phone),
    email: vazioParaNulo(dados.email)?.toLowerCase() ?? null,
    receivesReports: dados.receivesReports,
  }
}

export async function listarContactos(db: Database, organizationId: string): Promise<ContactoDaOrganizacao[]> {
  return db
    .select({
      id: organizationContacts.id,
      name: organizationContacts.name,
      jobTitle: organizationContacts.jobTitle,
      phone: organizationContacts.phone,
      email: organizationContacts.email,
      receivesReports: organizationContacts.receivesReports,
    })
    .from(organizationContacts)
    .where(eq(organizationContacts.organizationId, organizationId))
    .orderBy(asc(organizationContacts.name))
}

export async function acrescentarContacto(
  db: Database,
  organizationId: string,
  dados: DadosDoContacto,
): Promise<string> {
  const [linha] = await db
    .insert(organizationContacts)
    .values({ organizationId, ...normalizarContacto(dados) })
    .returning({ id: organizationContacts.id })
  return linha!.id
}

/** Só altera um contacto da organização indicada: o identificador sozinho não chega. */
export async function alterarContacto(
  db: Database,
  organizationId: string,
  contactoId: string,
  dados: DadosDoContacto,
): Promise<void> {
  await db
    .update(organizationContacts)
    .set({ ...normalizarContacto(dados), updatedAt: new Date() })
    .where(and(eq(organizationContacts.id, contactoId), eq(organizationContacts.organizationId, organizationId)))
}

export async function apagarContacto(db: Database, organizationId: string, contactoId: string): Promise<void> {
  await db
    .delete(organizationContacts)
    .where(and(eq(organizationContacts.id, contactoId), eq(organizationContacts.organizationId, organizationId)))
}

/**
 * Para quem vai o relatório mensal de um site.
 *
 * Os destinatários do próprio site e os contactos da organização marcados para
 * receber relatórios, sem repetidos e sem distinguir maiúsculas. Um contacto
 * marcado recebe os relatórios de todos os sites do cliente.
 */
export async function destinatariosDoRelatorio(db: Database, siteId: string): Promise<string[]> {
  const [site] = await db
    .select({ organizationId: sites.organizationId, reportRecipients: sites.reportRecipients })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1)
  if (!site) return []

  const contactos = await db
    .select({ email: organizationContacts.email })
    .from(organizationContacts)
    .where(
      and(eq(organizationContacts.organizationId, site.organizationId), eq(organizationContacts.receivesReports, true)),
    )

  const vistos = new Set<string>()
  const lista: string[] = []
  for (const email of [...site.reportRecipients, ...contactos.map((c) => c.email ?? '')]) {
    const chave = email.trim().toLowerCase()
    if (!chave.includes('@') || vistos.has(chave)) continue
    vistos.add(chave)
    lista.push(email.trim())
  }
  return lista
}
