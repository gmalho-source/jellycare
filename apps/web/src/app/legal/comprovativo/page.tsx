import { acceptedDocuments, schema } from '@jellycare/db'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { formatDateTime } from '@/components/ui'
import { getDb } from '@/lib/db'
import { renderLegalMarkdown } from '@/lib/legal'
import { requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * O comprovativo da aceitação.
 *
 * É o que o auditor do cliente vai pedir: o texto exato que foi aceite, quem
 * o aceitou, quando, com que cargo, de que endereço, e o resumo
 * criptográfico que liga uma coisa à outra.
 *
 * Página para imprimir e não PDF gerado no servidor. Gerar PDF exige o
 * Chromium, que mora no worker e de propósito não no dashboard — trazê-lo
 * para cá por causa desta página acrescentava meio giga à imagem e um motivo
 * novo para o dashboard falhar. Imprimir para PDF no browser dá ao cliente o
 * mesmo ficheiro. Se um dia for preciso o PDF assinado, é o worker que o
 * gera e guarda, como já faz com os relatórios.
 */
export default async function ComprovativoPage() {
  const user = await requireUser()
  const pertenca = user.memberships.find((m) => m.role === 'client') ?? user.memberships[0]
  if (!pertenca) notFound()

  const db = getDb()
  const [organizacao] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, pertenca.organizationId))
    .limit(1)

  const comprovativos = await acceptedDocuments(db, pertenca.organizationId)
  if (comprovativos.length === 0) notFound()

  return (
    <div className="space-y-8">
      <div className="print:hidden">
        <p className="text-sm text-ink-600">
          Use a impressão do browser para guardar em PDF.
        </p>
      </div>

      {comprovativos.map(({ acceptance, body }) => (
        <article
          key={acceptance.documentId}
          className="rounded-xl border border-ink-200 bg-white px-5 py-6 print:border-0 print:px-0"
        >
          <header className="border-b border-ink-200 pb-4">
            <h1 className="text-lg font-semibold tracking-tight">{acceptance.title}</h1>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-ink-600 sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-ink-400">Responsável pelo tratamento</dt>
                <dd className="text-ink-900">{organizacao?.name ?? '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-400">Versão</dt>
                <dd className="text-ink-900">{acceptance.version}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-400">Aceite em</dt>
                <dd className="text-ink-900">{formatDateTime(acceptance.acceptedAt)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-400">Na qualidade de</dt>
                <dd className="text-ink-900">{acceptance.representedBy}</dd>
              </div>
              {acceptance.ip && (
                <div className="flex gap-2">
                  <dt className="text-ink-400">Endereço de origem</dt>
                  <dd className="font-mono text-ink-900">{acceptance.ip}</dd>
                </div>
              )}
            </dl>
          </header>

          <div
            className="legal-prose mt-6"
            dangerouslySetInnerHTML={{ __html: renderLegalMarkdown(body) }}
          />
        </article>
      ))}
    </div>
  )
}
