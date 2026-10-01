import { lerCaptura, schema } from '@jellycare/db'
import { eq } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'

/**
 * A imagem da homepage de um site, para o cartão da grelha.
 *
 * A pertença à organização é verificada aqui, como no PDF do relatório: a
 * imagem de um site em desenvolvimento ou de uma área reservada não é pública
 * só porque o identificador é difícil de adivinhar.
 *
 * O URL leva a data da captura (`?v=`), por isso a resposta pode ficar em
 * cache no browser: uma captura nova muda o URL.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'nao_autenticado' }, { status: 401 })

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'nao_encontrado' }, { status: 404 })
  const db = getDb()

  const [site] = await db
    .select({ organizationId: schema.sites.organizationId })
    .from(schema.sites)
    .where(eq(schema.sites.id, id))
    .limit(1)

  // A mesma resposta para «não existe» e «não é seu».
  if (!site || !user.memberships.some((m) => m.organizationId === site.organizationId)) {
    return NextResponse.json({ error: 'nao_encontrado' }, { status: 404 })
  }

  const captura = await lerCaptura(db, id)
  if (!captura) return NextResponse.json({ error: 'nao_encontrado' }, { status: 404 })

  return new NextResponse(new Uint8Array(captura.image), {
    headers: {
      'content-type': captura.mimeType,
      'cache-control': 'private, max-age=86400',
      // A imagem vem de fora (da Google, que fotografou o site do cliente):
      // nunca é interpretada como outra coisa que não uma imagem.
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  })
}
