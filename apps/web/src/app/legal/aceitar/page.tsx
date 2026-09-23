import Link from 'next/link'
import { acceptedDocuments } from '@jellycare/db'
import { Card, CardHeader, formatDateTime } from '@/components/ui'
import { getDb } from '@/lib/db'
import { daysUntil, getLegalState, renderLegalMarkdown } from '@/lib/legal'
import { requireUser } from '@/lib/session'
import { AcceptForm } from './accept-form'
import { ObjectionForm } from './objection-form'

export const dynamic = 'force-dynamic'

/**
 * O acordo de tratamento de dados, para ler e aceitar.
 *
 * Mora no portal porque é o cliente que aceita: é ele o responsável pelo
 * tratamento e nós a subcontratante. O texto integral está na página, acima
 * do botão — aceitar uma ligação para um PDF não é aceitar o que lá está.
 */
export default async function PortalLegalPage() {
  const user = await requireUser()

  // Um cliente pertence a uma organização. Havendo mais, trata-se a primeira
  // de que é cliente — é a que o portal já mostra.
  const pertenca =
    user.memberships.find((m) => m.role === 'client') ?? user.memberships[0]
  if (!pertenca) {
    return <p className="text-sm text-ink-600">Não há nada associado a esta conta.</p>
  }

  const organizationId = pertenca.organizationId
  const estado = await getLegalState(organizationId)
  const comprovativos = await acceptedDocuments(getDb(), organizationId)
  const podeAceitar = pertenca.role === 'client'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Tratamento de dados</h1>
        <p className="mt-1 text-sm text-ink-600">
          O acordo que enquadra o que fazemos com os dados dos seus sites, exigido pelo artigo
          28.º do RGPD.
        </p>
      </div>

      {estado.negotiatedRef && (
        <Card className="p-5">
          <p className="text-sm text-ink-900">
            Esta conta rege-se por um acordo negociado à parte.
          </p>
          <p className="mt-1 text-xs text-ink-400">Referência: {estado.negotiatedRef}</p>
        </Card>
      )}

      {estado.pendingSubprocessors && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-900">
            Vamos passar a usar um subcontratante novo
          </h2>
          <p className="mt-1.5 text-sm text-amber-900/80">
            A lista entra em vigor a {formatDateTime(estado.pendingSubprocessors.effectiveAt)},
            daqui a {daysUntil(estado.pendingSubprocessors.effectiveAt)}{' '}
            {daysUntil(estado.pendingSubprocessors.effectiveAt) === 1 ? 'dia' : 'dias'}.{' '}
            <Link href="/legal/subcontratantes" className="underline underline-offset-2">
              Ver o que muda
            </Link>
            .
          </p>
          {estado.objected ? (
            <p className="mt-3 text-sm text-amber-900">
              A sua oposição está registada. Falamos consigo antes da data.
            </p>
          ) : podeAceitar ? (
            <ObjectionForm
              organizationId={organizationId}
              documentId={estado.pendingSubprocessors.id}
            />
          ) : null}
        </div>
      )}

      {estado.missing.length > 0 && !estado.negotiatedRef ? (
        <>
          {estado.missing.map((documento) => (
            <article key={documento.id} className="space-y-3">
              <div className="rounded-2xl bg-white shadow-card px-5 py-4">
                <h2 className="text-base font-semibold tracking-tight">{documento.title}</h2>
                <p className="mt-1 text-xs text-ink-400">
                  Versão {documento.version} · em vigor desde{' '}
                  {formatDateTime(documento.effectiveAt)}
                </p>
              </div>
              <div
                className="legal-prose max-h-[28rem] overflow-y-auto rounded-2xl bg-white shadow-card px-5 py-6"
                dangerouslySetInnerHTML={{ __html: renderLegalMarkdown(documento.body) }}
              />
            </article>
          ))}

          {podeAceitar ? (
            <AcceptForm
              organizationId={organizationId}
              documentIds={estado.missing.map((documento) => documento.id)}
              titulos={estado.missing.map((documento) => documento.title)}
            />
          ) : (
            <Card className="p-5">
              <p className="text-sm text-ink-600">
                Este acordo é aceite por um representante do cliente. A sua conta é de equipa.
              </p>
            </Card>
          )}
        </>
      ) : null}

      {comprovativos.length > 0 && (
        <Card>
          <CardHeader
            title="Aceite"
            action={
              <Link
                href="/legal/comprovativo"
                className="text-xs font-medium text-ink-900 underline underline-offset-2"
              >
                Comprovativo
              </Link>
            }
          />
          <ul className="divide-y divide-ink-100">
            {comprovativos.map(({ acceptance }) => (
              <li key={acceptance.documentId} className="px-5 py-3 text-sm">
                <p className="text-ink-900">
                  {acceptance.title} <span className="text-ink-400">v{acceptance.version}</span>
                </p>
                <p className="mt-0.5 text-xs text-ink-400">
                  Aceite a {formatDateTime(acceptance.acceptedAt)} por{' '}
                  {acceptance.representedBy}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
