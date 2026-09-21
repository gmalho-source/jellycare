import {
  currentDocument,
  documentHistory,
  organizationLegalState,
  pendingDocument,
  type LegalKind,
  type LegalLocale,
} from '@jellycare/db'
import { marked } from 'marked'
import { getDb } from './db'

/**
 * Os documentos legais, do lado do dashboard.
 *
 * Lê sempre da base de dados. O texto vive no repositório, mas quem o põe lá
 * é a sincronização do worker: o `next build` não copia ficheiros lidos em
 * tempo de execução, e um contrato que desaparece da imagem de produção é
 * uma página de erro no sítio onde o cliente devia estar a ler o que aceita.
 */

/** Os endereços públicos, e o tipo a que correspondem. */
export const LEGAL_SLUGS: Record<string, { kind: LegalKind; locale: LegalLocale }> = {
  dpa: { kind: 'dpa', locale: 'pt' },
  'dpa-en': { kind: 'dpa', locale: 'en' },
  subcontratantes: { kind: 'subprocessors', locale: 'pt' },
  subprocessors: { kind: 'subprocessors', locale: 'en' },
  termos: { kind: 'terms', locale: 'pt' },
  terms: { kind: 'terms', locale: 'en' },
}

/**
 * Markdown para HTML.
 *
 * O conteúdo vem do nosso repositório e passa pelo worker — não há caminho
 * por onde entre texto de um utilizador. Ainda assim, o `<` é escapado antes
 * de converter: nenhum destes documentos tem HTML de propósito, e assim um
 * dia em que alguém cole algo de um sítio qualquer para dentro de um `.md`
 * não se transforma num problema de segurança numa página pública.
 */
export function renderLegalMarkdown(body: string): string {
  const semHtml = body.replace(/</g, '&lt;')
  const html = marked.parse(semHtml, { async: false, gfm: true, breaks: false })
  // As tabelas dos anexos têm cinco colunas e não encolhem. Cada uma leva um
  // invólucro que rola sozinho, para a página não rolar por causa delas.
  return html.replace(/<table>/g, '<div class="legal-table"><table>').replace(
    /<\/table>/g,
    '</table></div>',
  )
}

export async function getLegalDocument(slug: string) {
  const entry = LEGAL_SLUGS[slug]
  if (!entry) return null

  const [atual, anunciado, historico] = await Promise.all([
    currentDocument(getDb(), entry.kind, entry.locale),
    pendingDocument(getDb(), entry.kind, entry.locale),
    documentHistory(getDb(), entry.kind, entry.locale),
  ])

  if (!atual && !anunciado) return null
  return { ...entry, atual, anunciado, historico }
}

export async function getLegalState(organizationId: string) {
  return organizationLegalState(getDb(), organizationId)
}

/** Dias inteiros até uma data, nunca negativo. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 86_400_000))
}
