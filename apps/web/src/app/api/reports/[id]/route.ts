import { schema } from '@jellycare/db'
import { eq } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'

/**
 * Descarrega o PDF de um relatório.
 *
 * A pertença à organização é verificada aqui e não confiada ao facto de o
 * identificador ser difícil de adivinhar: um relatório mensal contém o retrato
 * de segurança de um site de um cliente.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'nao_autenticado' }, { status: 401 })

  const { id } = await params
  const db = getDb()

  const rows = await db
    .select({
      pdf: schema.reports.pdf,
      fileName: schema.reports.fileName,
      organizationId: schema.sites.organizationId,
    })
    .from(schema.reports)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.reports.siteId))
    .where(eq(schema.reports.id, id))
    .limit(1)

  const report = rows[0]
  // A mesma resposta para "não existe" e "não é seu": confirmar a existência
  // de um relatório de outro cliente já é informação a mais.
  const permitted =
    report && user.memberships.some((m) => m.organizationId === report.organizationId)
  if (!permitted) return NextResponse.json({ error: 'nao_encontrado' }, { status: 404 })

  return new NextResponse(new Uint8Array(report.pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${report.fileName}"`,
      'cache-control': 'private, no-store',
    },
  })
}
