import { resolveSession, type AuthenticatedUser } from '@jellycare/db'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDb } from './db'

export const SESSION_COOKIE = 'jellycare_session'

export interface SessionCookieOptions {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: string
  expires: Date
}

/**
 * Opções do cookie de sessão.
 *
 * `httpOnly` impede que um script injetado leia a sessão, e `sameSite: lax`
 * cobre CSRF nos pedidos que interessam sem partir a entrada pelo link do
 * email, que chega por navegação de topo.
 */
export function sessionCookieOptions(expiresAt: Date): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  }
}

/** Utilizador autenticado, ou `null`. Não redireciona. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  return resolveSession(getDb(), token)
}

/** Utilizador autenticado, ou redireciona para a entrada. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

/**
 * Confirma que o utilizador pertence à organização.
 *
 * Todas as leituras de dados de um site passam por aqui. Um identificador de
 * site vindo do URL nunca é suficiente para ver os dados desse site.
 */
export function assertMembership(user: AuthenticatedUser, organizationId: string): void {
  const member = user.memberships.some(
    (membership) => membership.organizationId === organizationId,
  )
  if (!member) redirect('/')
}

/**
 * O utilizador é um cliente e mais nada.
 *
 * Não basta ter um papel `client` algures: quem pertence à Jelly e é cliente
 * de si próprio continua a ser equipa. Só quando todas as pertenças são de
 * cliente é que a pessoa não tem nada que fazer no painel interno.
 */
export function isClientOnly(user: AuthenticatedUser): boolean {
  return (
    user.memberships.length > 0 &&
    user.memberships.every((membership) => membership.role === 'client')
  )
}

/** Só a equipa da Jelly configura sites; o papel `client` é de leitura. */
export function canManage(user: AuthenticatedUser, organizationId: string): boolean {
  return user.memberships.some(
    (membership) =>
      membership.organizationId === organizationId && membership.role !== 'client',
  )
}
