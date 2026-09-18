import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm'
import type { Database } from './client.js'
import { loginTokens, memberships, sessions, users } from './schema.js'

/**
 * Autenticação sem palavras-passe.
 *
 * A plataforma acumula acesso privilegiado a dezenas de sites de clientes, o
 * que a torna um alvo de valor. Guardar apenas o hash dos tokens significa que
 * uma fuga da base de dados não dá a ninguém a capacidade de entrar.
 */

const LOGIN_TOKEN_TTL_MS = 15 * 60_000
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Comparação em tempo constante, para não vazar o token byte a byte. */
export function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

export interface AuthenticatedUser {
  id: string
  email: string
  name: string | null
  memberships: { organizationId: string; role: string }[]
}

/**
 * Cria uma ligação de entrada para um email já registado.
 *
 * Devolve `null` quando o email não pertence a ninguém — e quem chama deve
 * responder exatamente o mesmo nos dois casos, para não transformar o
 * formulário de entrada num verificador de quem tem conta.
 */
export async function createLoginToken(
  db: Database,
  email: string,
  now: Date = new Date(),
): Promise<{ token: string; userId: string } | null> {
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1)

  const user = found[0]
  if (!user) return null

  const token = generateToken()
  await db.insert(loginTokens).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MS),
  })

  return { token, userId: user.id }
}

export interface SessionCreated {
  sessionToken: string
  expiresAt: Date
  user: AuthenticatedUser
}

/**
 * Troca uma ligação de entrada por uma sessão.
 *
 * O token é marcado como consumido dentro da mesma transação em que a sessão é
 * criada: sem isso, um link intercetado poderia ser usado várias vezes.
 */
export async function consumeLoginToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<SessionCreated | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(loginTokens)
      .where(eq(loginTokens.tokenHash, hashToken(token)))
      .limit(1)

    const loginToken = rows[0]
    if (!loginToken) return null
    if (loginToken.consumedAt !== null) return null
    if (loginToken.expiresAt.getTime() <= now.getTime()) return null

    await tx
      .update(loginTokens)
      .set({ consumedAt: now })
      .where(eq(loginTokens.id, loginToken.id))

    const sessionToken = generateToken()
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)

    await tx.insert(sessions).values({
      userId: loginToken.userId,
      tokenHash: hashToken(sessionToken),
      expiresAt,
    })

    const user = await loadUser(tx as unknown as Database, loginToken.userId)
    if (!user) return null

    return { sessionToken, expiresAt, user }
  })
}

async function loadUser(db: Database, userId: string): Promise<AuthenticatedUser | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      organizationId: memberships.organizationId,
      role: memberships.role,
    })
    .from(users)
    .leftJoin(memberships, eq(memberships.userId, users.id))
    .where(eq(users.id, userId))

  const first = rows[0]
  if (!first) return null

  return {
    id: first.id,
    email: first.email,
    name: first.name,
    memberships: rows
      .filter((row) => row.organizationId !== null)
      .map((row) => ({ organizationId: row.organizationId as string, role: row.role as string })),
  }
}

/** Resolve a sessão de um pedido. `null` quando expirada ou inexistente. */
export async function resolveSession(
  db: Database,
  sessionToken: string,
  now: Date = new Date(),
): Promise<AuthenticatedUser | null> {
  const rows = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(sessionToken)), gt(sessions.expiresAt, now)))
    .limit(1)

  const session = rows[0]
  if (!session) return null

  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id))

  return loadUser(db, session.userId)
}

export async function revokeSession(db: Database, sessionToken: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(sessionToken)))
}

/** Limpa sessões expiradas e tokens gastos. Corre no worker, periodicamente. */
export async function pruneExpiredAuth(db: Database, now: Date = new Date()): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now))
  await db
    .delete(loginTokens)
    .where(or(lt(loginTokens.expiresAt, now), and(isNull(loginTokens.consumedAt), lt(loginTokens.expiresAt, now))))
}

/* -------------------------------------------------------------------------- */
/* Acessos                                                                    */
/* -------------------------------------------------------------------------- */

export type GrantableRole = 'admin' | 'member' | 'client'

export interface OrganizationMember {
  userId: string
  email: string
  name: string | null
  role: string
  since: Date
}

export async function listMembers(
  db: Database,
  organizationId: string,
): Promise<OrganizationMember[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      since: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(users.email)

  return rows
}

export interface GrantedAccess {
  userId: string
  /**
   * Falso quando a pessoa já tinha acesso.
   *
   * Quem chama usa isto para decidir se avisa por email: repetir o aviso a
   * cada vez que alguém carrega no botão transforma um convite em spam.
   */
  created: boolean
}

/**
 * Dá acesso a uma organização, criando o utilizador se ele ainda não existir.
 *
 * Não emite nenhuma credencial. A plataforma entra-se por ligação de uso único
 * válida quinze minutos, e mandá-la num convite seria pô-la a morrer antes de
 * a pessoa abrir o email — ou, pior, deixá-la viva numa caixa de correio e em
 * cada reencaminhamento. O acesso passa a existir; a chave a pessoa pede-a a
 * si própria.
 */
export async function grantAccess(
  db: Database,
  options: { organizationId: string; email: string; role: GrantableRole },
): Promise<GrantedAccess> {
  const email = options.email.toLowerCase().trim()

  return db.transaction(async (tx) => {
    const found = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)

    const userId =
      found[0]?.id ??
      (await tx.insert(users).values({ email }).returning({ id: users.id }))[0]!.id

    const existing = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.organizationId, options.organizationId), eq(memberships.userId, userId)))
      .limit(1)

    if (existing[0]) {
      // O papel é atualizado: promover ou despromover alguém é a mesma ação.
      await tx.update(memberships).set({ role: options.role }).where(eq(memberships.id, existing[0].id))
      return { userId, created: false }
    }

    await tx
      .insert(memberships)
      .values({ organizationId: options.organizationId, userId, role: options.role })

    return { userId, created: true }
  })
}

/**
 * Retira o acesso de alguém a uma organização.
 *
 * O utilizador não é apagado: pode pertencer a outras organizações, e apagá-lo
 * levaria com ele as sessões e o histórico. Sem pertenças, não vê nada.
 */
export async function revokeAccess(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))

  // As sessões abertas dessa pessoa deixam de dar acesso a esta organização
  // na leitura seguinte, porque as pertenças são resolvidas a cada pedido.
}
