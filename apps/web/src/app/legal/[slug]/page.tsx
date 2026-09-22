import { notFound } from 'next/navigation'
import { formatDateTime } from '@/components/ui'
import { daysUntil, getLegalDocument, renderLegalMarkdown } from '@/lib/legal'

// Sem `generateStaticParams`: com ele o Next pré-renderia estas páginas no
// build, e uma versão publicada a seguir só apareceria no deploy seguinte. Um
// documento legal tem de refletir o que está na base de dados no momento em
// que é lido.
export const dynamic = 'force-dynamic'

/**
 * Um documento legal, na versão em vigor.
 *
 * O cabeçalho diz a versão e desde quando vale, porque é isso que distingue
 * um contrato de um texto num sítio. Quando há uma versão anunciada mas ainda
 * não em vigor, ela aparece por cima com a contagem dos dias: é o pré-aviso
 * da cláusula 7.ª a acontecer à vista, e não num email que se perde.
 */
export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const documento = await getLegalDocument(slug)
  if (!documento) notFound()

  const { atual, anunciado, historico } = documento
  const visivel = atual ?? anunciado!

  return (
    <article className="space-y-6">
      {anunciado && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-900">
            Alteração anunciada, ainda sem efeito
          </h2>
          <p className="mt-1.5 text-sm text-amber-900/80">
            A versão {anunciado.version} entra em vigor a{' '}
            {formatDateTime(anunciado.effectiveAt)} — daqui a{' '}
            {daysUntil(anunciado.effectiveAt)}{' '}
            {daysUntil(anunciado.effectiveAt) === 1 ? 'dia' : 'dias'}. Até lá vale a versão
            anterior. Se for cliente e quiser opor-se, pode fazê-lo no portal.
          </p>
        </div>
      )}

      <header className="rounded-xl border border-ink-200 bg-white px-5 py-4">
        <h1 className="text-lg font-semibold tracking-tight">{visivel.title}</h1>
        <p className="mt-1 text-xs text-ink-400">
          Versão {visivel.version} · em vigor desde {formatDateTime(visivel.effectiveAt)} ·
          publicada a {formatDateTime(visivel.publishedAt)}
        </p>
        <p className="mt-1 break-all font-mono text-[11px] text-ink-400">
          SHA-256 {visivel.contentHash}
        </p>
      </header>

      <div
        className="legal-prose rounded-xl border border-ink-200 bg-white px-5 py-6"
        dangerouslySetInnerHTML={{ __html: renderLegalMarkdown(visivel.body) }}
      />

      {historico.length > 1 && (
        <section className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-ink-900">Versões</h2>
          <ul className="mt-2 space-y-1 text-xs text-ink-600">
            {historico.map((versao) => (
              <li key={versao.id}>
                v{versao.version} — {formatDateTime(versao.effectiveAt)}
                {versao.id === visivel.id ? ' (a que está a ler)' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
