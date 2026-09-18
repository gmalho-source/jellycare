import { consumeLoginToken } from '@jellycare/db'
import { NextResponse, type NextRequest } from 'next/server'
import { appUrl } from '@/lib/app-url'
import { getDb } from '@/lib/db'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session'

/**
 * Troca a ligação de entrada por uma sessão.
 *
 * Qualquer falha — token inexistente, expirado ou já usado — devolve a mesma
 * mensagem: dizer qual dos três foi daria a quem intercetasse o link
 * informação que não precisa de ter.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token')
  const failure = NextResponse.redirect(appUrl('/login?erro=ligacao', request.headers))

  if (!token) return failure

  const session = await consumeLoginToken(getDb(), token)
  if (!session) return failure

  const response = NextResponse.redirect(appUrl('/', request.headers))
  // O cookie é escrito nesta resposta e não no store global: num route handler
  // que constrói a sua própria resposta, o que se escreve em `cookies()` não a
  // acompanha, e a sessão ficava criada na base de dados sem nunca chegar ao
  // browser.
  response.cookies.set(SESSION_COOKIE, session.sessionToken, sessionCookieOptions(session.expiresAt))

  return response
}
