import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import type { Database } from './client.js'
import {
  legalAcceptances,
  legalDocuments,
  legalObjections,
  organizations,
} from './schema.js'

/**
 * O estado legal de uma organização.
 *
 * Só leitura da base de dados: os documentos chegam cá pela sincronização do
 * worker, e o dashboard nunca toca em ficheiros.
 */

export type LegalKind = 'dpa' | 'subprocessors' | 'terms'
export type LegalLocale = 'pt' | 'en'

export interface LegalDocumentRow {
  id: string
  kind: LegalKind
  locale: LegalLocale
  version: number
  title: string
  body: string
  contentHash: string
  publishedAt: Date
  effectiveAt: Date
}

export interface AcceptanceRow {
  documentId: string
  kind: LegalKind
  locale: LegalLocale
  version: number
  title: string
  acceptedAt: Date
  representedBy: string
  userEmail: string | null
  ip: string | null
}

/**
 * A versão em vigor de um documento, por locale.
 *
 * Em vigor é a de maior versão cuja `effectiveAt` já passou. Uma versão com
 * data futura existe na tabela e é visível como pré-aviso, mas não é esta —
 * é isso que faz os 30 dias da cláusula 7.ª significarem alguma coisa.
 */
export async function currentDocument(
  db: Database,
  kind: LegalKind,
  locale: LegalLocale,
  now: Date = new Date(),
): Promise<LegalDocumentRow | null> {
  const rows = await db
    .select()
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.kind, kind),
        eq(legalDocuments.locale, locale),
        lte(legalDocuments.effectiveAt, now),
      ),
    )
    .orderBy(desc(legalDocuments.version))
    .limit(1)

  return (rows[0] as LegalDocumentRow | undefined) ?? null
}

/**
 * Uma versão anunciada que ainda não entrou em vigor.
 *
 * É o pré-aviso: existe, é pública, e conta os dias até substituir a atual.
 */
export async function pendingDocument(
  db: Database,
  kind: LegalKind,
  locale: LegalLocale,
  now: Date = new Date(),
): Promise<LegalDocumentRow | null> {
  const rows = await db
    .select()
    .from(legalDocuments)
    .where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.locale, locale)))
    .orderBy(desc(legalDocuments.version))
    .limit(1)

  const latest = rows[0] as LegalDocumentRow | undefined
  if (!latest) return null
  return latest.effectiveAt > now ? latest : null
}

export interface OrganizationLegalState {
  /** Preenchido quando o cliente impôs o contrato dele: o fluxo online não se aplica. */
  negotiatedRef: string | null
  /** Documentos exigidos que faltam aceitar, na versão em vigor. */
  missing: LegalDocumentRow[]
  accepted: AcceptanceRow[]
  /** Alteração anunciada à lista de subcontratantes, se houver. */
  pendingSubprocessors: LegalDocumentRow | null
  /** Já houve oposição registada ao pré-aviso em curso. */
  objected: boolean
}

export async function organizationLegalState(
  db: Database,
  organizationId: string,
  options: {
    required?: readonly LegalKind[]
    locale?: LegalLocale
    now?: Date
  } = {},
): Promise<OrganizationLegalState> {
  const required = options.required ?? (['dpa'] as const)
  const locale = options.locale ?? 'pt'
  const now = options.now ?? new Date()

  const [orgRows, acceptanceRows] = await Promise.all([
    db
      .select({ negotiatedDpaRef: organizations.negotiatedDpaRef })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
    db
      .select({
        documentId: legalAcceptances.documentId,
        acceptedAt: legalAcceptances.acceptedAt,
        representedBy: legalAcceptances.representedBy,
        ip: legalAcceptances.ip,
        kind: legalDocuments.kind,
        locale: legalDocuments.locale,
        version: legalDocuments.version,
        title: legalDocuments.title,
      })
      .from(legalAcceptances)
      .innerJoin(legalDocuments, eq(legalDocuments.id, legalAcceptances.documentId))
      .where(eq(legalAcceptances.organizationId, organizationId))
      .orderBy(desc(legalAcceptances.acceptedAt)),
  ])

  const accepted = acceptanceRows.map((row) => ({
    ...row,
    userEmail: null,
  })) as AcceptanceRow[]

  const acceptedIds = new Set(accepted.map((row) => row.documentId))

  const missing: LegalDocumentRow[] = []
  for (const kind of required) {
    const current = await currentDocument(db, kind, locale, now)
    // Sem documento publicado não há nada a exigir. É o caso dos Termos &
    // Condições enquanto não existirem: o mecanismo não pode bloquear um
    // cliente à espera de um texto que ainda ninguém escreveu.
    if (!current) continue
    if (!acceptedIds.has(current.id)) missing.push(current)
  }

  const pendingSubprocessors = await pendingDocument(db, 'subprocessors', locale, now)

  let objected = false
  if (pendingSubprocessors) {
    const rows = await db
      .select({ id: legalObjections.id })
      .from(legalObjections)
      .where(
        and(
          eq(legalObjections.organizationId, organizationId),
          eq(legalObjections.documentId, pendingSubprocessors.id),
        ),
      )
      .limit(1)
    objected = rows.length > 0
  }

  return {
    negotiatedRef: orgRows[0]?.negotiatedDpaRef ?? null,
    missing,
    accepted,
    pendingSubprocessors,
    objected,
  }
}

/**
 * Registar uma aceitação.
 *
 * Idempotente por (organização, documento): carregar duas vezes no botão não
 * cria dois contratos, e a primeira aceitação — que é a que vale — mantém a
 * sua data.
 */
export async function recordAcceptance(
  db: Database,
  input: {
    organizationId: string
    documentIds: string[]
    userId: string
    representedBy: string
    ip?: string | null
    userAgent?: string | null
  },
): Promise<number> {
  if (input.documentIds.length === 0) return 0

  const inserted = await db
    .insert(legalAcceptances)
    .values(
      input.documentIds.map((documentId) => ({
        organizationId: input.organizationId,
        documentId,
        userId: input.userId,
        representedBy: input.representedBy,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: legalAcceptances.id })

  return inserted.length
}

export async function recordObjection(
  db: Database,
  input: { organizationId: string; documentId: string; userId: string; reason: string },
): Promise<void> {
  await db.insert(legalObjections).values(input)
}

/** Os documentos aceites por uma organização, para o comprovativo. */
export async function acceptedDocuments(
  db: Database,
  organizationId: string,
): Promise<{ acceptance: AcceptanceRow; body: string }[]> {
  const rows = await db
    .select({
      documentId: legalAcceptances.documentId,
      acceptedAt: legalAcceptances.acceptedAt,
      representedBy: legalAcceptances.representedBy,
      ip: legalAcceptances.ip,
      kind: legalDocuments.kind,
      locale: legalDocuments.locale,
      version: legalDocuments.version,
      title: legalDocuments.title,
      body: legalDocuments.body,
    })
    .from(legalAcceptances)
    .innerJoin(legalDocuments, eq(legalDocuments.id, legalAcceptances.documentId))
    .where(eq(legalAcceptances.organizationId, organizationId))
    .orderBy(desc(legalAcceptances.acceptedAt))

  return rows.map(({ body, ...acceptance }) => ({
    acceptance: { ...acceptance, userEmail: null } as AcceptanceRow,
    body,
  }))
}

/** Todas as versões de um tipo, para a página pública de histórico. */
export async function documentHistory(
  db: Database,
  kind: LegalKind,
  locale: LegalLocale,
): Promise<LegalDocumentRow[]> {
  const rows = await db
    .select()
    .from(legalDocuments)
    .where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.locale, locale)))
    .orderBy(desc(legalDocuments.version))

  return rows as LegalDocumentRow[]
}

/** Utilizado pelos testes e pelo ecrã de aceitação. */
export async function documentsByIds(
  db: Database,
  ids: string[],
): Promise<LegalDocumentRow[]> {
  if (ids.length === 0) return []
  const rows = await db.select().from(legalDocuments).where(inArray(legalDocuments.id, ids))
  return rows as LegalDocumentRow[]
}

/**
 * Marcar — ou desmarcar — que esta organização se rege por um contrato
 * negociado à parte.
 *
 * Vazio limpa a marca e devolve a organização ao fluxo online. É a operação
 * que faltava: a coluna sozinha era uma promessa sem interruptor.
 */
export async function setNegotiatedDpaRef(
  db: Database,
  organizationId: string,
  ref: string | null,
): Promise<void> {
  await db
    .update(organizations)
    .set({ negotiatedDpaRef: ref && ref.trim().length > 0 ? ref.trim() : null })
    .where(eq(organizations.id, organizationId))
}

export interface ObjectionRow {
  id: string
  reason: string
  createdAt: Date
  documentTitle: string
  documentVersion: number
}

/** As oposições registadas por uma organização, mais recentes primeiro. */
export async function organizationObjections(
  db: Database,
  organizationId: string,
): Promise<ObjectionRow[]> {
  const rows = await db
    .select({
      id: legalObjections.id,
      reason: legalObjections.reason,
      createdAt: legalObjections.createdAt,
      documentTitle: legalDocuments.title,
      documentVersion: legalDocuments.version,
    })
    .from(legalObjections)
    .innerJoin(legalDocuments, eq(legalDocuments.id, legalObjections.documentId))
    .where(eq(legalObjections.organizationId, organizationId))
    .orderBy(desc(legalObjections.createdAt))

  return rows
}
