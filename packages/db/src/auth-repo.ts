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
