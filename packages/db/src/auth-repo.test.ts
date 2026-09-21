import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  consumeLoginToken,
  createLoginToken,
  hashToken,
  resolveSession,
  revokeSession,
  tokensMatch,
} from './auth-repo.js'
import { createDatabase } from './client.js'
import { loginTokens, memberships, organizations, sessions, users } from './schema.js'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 4 })

let userId: string
let organizationId: string
/** Email único por execução, para não colidir com dados de outros testes. */
let email: string

async function cleanup(): Promise<void> {
  // Só o que este ficheiro criou: apagar tudo partiria os testes que correm
  // em paralelo contra a mesma base de dados.
  if (userId) await db.delete(users).where(eq(users.id, userId))
  if (organizationId) await db.delete(organizations).where(eq(organizations.id, organizationId))
}

afterAll(async () => {
  await cleanup()
  await close()
})

beforeEach(async () => {
  await cleanup()
  email = `auth-${Date.now()}-${Math.round(Math.random() * 1e6)}@jelly.pt`

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Jelly', slug: `jelly-${Date.now()}-${Math.random()}` })
    .returning({ id: organizations.id })
  organizationId = org!.id

  const [user] = await db
    .insert(users)
    .values({ email, name: 'Gonçalo' })
    .returning({ id: users.id })
  userId = user!.id

  await db.insert(memberships).values({ organizationId, userId, role: 'owner' })
})

describe('tokensMatch', () => {
  it('compara valores iguais e diferentes', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true)
    expect(tokensMatch('abc', 'abd')).toBe(false)
  })

  it('não rebenta com comprimentos diferentes', () => {
    expect(tokensMatch('abc', 'abcdef')).toBe(false)
  })
})

describe('createLoginToken', () => {
  it('cria um token para um email conhecido', async () => {
    const result = await createLoginToken(db, email)

    expect(result?.userId).toBe(userId)
    expect(result?.token).toBeTruthy()
  })

  it('guarda apenas o hash, nunca o token', async () => {
    const result = await createLoginToken(db, email)
    const rows = await db.select().from(loginTokens).where(eq(loginTokens.userId, userId))

    // Uma fuga da base de dados não pode dar a ninguém a capacidade de entrar.
    expect(rows[0]?.tokenHash).toBe(hashToken(result!.token))
    expect(rows[0]?.tokenHash).not.toBe(result!.token)
  })

  it('normaliza o email', async () => {
    expect(await createLoginToken(db, `  ${email.toUpperCase()}  `)).not.toBeNull()
  })

  it('devolve nulo para um email desconhecido', async () => {
    // Quem chama tem de responder o mesmo nos dois casos, para o formulário de
    // entrada não se tornar um verificador de quem tem conta.
    expect(await createLoginToken(db, 'ninguem@exemplo.pt')).toBeNull()
  })
})

describe('consumeLoginToken', () => {
  it('troca o token por uma sessão com o utilizador e as suas organizações', async () => {
    const login = await createLoginToken(db, email)
    const session = await consumeLoginToken(db, login!.token)

    expect(session?.user.email).toBe(email)
    expect(session?.user.memberships).toEqual([{ organizationId, role: 'owner' }])
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('não permite usar o mesmo link duas vezes', async () => {
    const login = await createLoginToken(db, email)

    expect(await consumeLoginToken(db, login!.token)).not.toBeNull()
    // Um link intercetado não pode servir de chave permanente.
    expect(await consumeLoginToken(db, login!.token)).toBeNull()
  })

  it('recusa um token expirado', async () => {
    const login = await createLoginToken(db, email)
    const muitoDepois = new Date(Date.now() + 60 * 60_000)

    expect(await consumeLoginToken(db, login!.token, muitoDepois)).toBeNull()
  })

  it('recusa um token inventado', async () => {
    expect(await consumeLoginToken(db, 'token-que-nunca-existiu')).toBeNull()
  })

  it('não deixa sessão pendurada quando o token é inválido', async () => {
    await consumeLoginToken(db, 'invalido')
    const rows = await db.select().from(sessions).where(eq(sessions.userId, userId))
    expect(rows).toHaveLength(0)
  })
})

describe('resolveSession', () => {
  it('resolve uma sessão válida', async () => {
    const login = await createLoginToken(db, email)
    const created = await consumeLoginToken(db, login!.token)

    const user = await resolveSession(db, created!.sessionToken)
    expect(user?.id).toBe(userId)
  })

  it('não resolve uma sessão expirada', async () => {
    const login = await createLoginToken(db, email)
    const created = await consumeLoginToken(db, login!.token)

    const daquiA60Dias = new Date(Date.now() + 60 * 24 * 60 * 60_000)
    expect(await resolveSession(db, created!.sessionToken, daquiA60Dias)).toBeNull()
  })

  it('não resolve um token de sessão inventado', async () => {
    expect(await resolveSession(db, 'inventado')).toBeNull()
  })

  it('regista a última utilização', async () => {
    const login = await createLoginToken(db, email)
    const created = await consumeLoginToken(db, login!.token)

    const depois = new Date(Date.now() + 60_000)
    await resolveSession(db, created!.sessionToken, depois)

    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(created!.sessionToken)))
    expect(rows[0]?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(depois.getTime() - 1000)
  })
})

describe('revokeSession', () => {
  it('termina a sessão', async () => {
    const login = await createLoginToken(db, email)
    const created = await consumeLoginToken(db, login!.token)

    await revokeSession(db, created!.sessionToken)
    expect(await resolveSession(db, created!.sessionToken)).toBeNull()
  })
})
