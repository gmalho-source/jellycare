import { schema, type Database } from '@jellycare/db'
import { and, eq } from 'drizzle-orm'
import { loadDocuments, type LoadedDocument } from './load.js'

/**
 * Levar o que está no repositório para a base de dados.
 *
 * Corre no arranque do worker, a seguir às migrações. Uma versão que ainda
 * não exista é inserida; uma que já exista é comparada e nunca reescrita.
 *
 * A recusa é o ponto todo. Uma linha de `legal_documents` é prova de um
 * contrato: se o ficheiro mudar sem a versão subir, reescrever a linha
 * apagaria o texto que um cliente aceitou e punha outro no lugar, com a
 * mesma data e o mesmo registo de aceitação. Preferimos que o arranque falhe
 * com uma mensagem clara.
 */

export interface SyncOutcome {
  inserted: { kind: string; locale: string; version: number }[]
  unchanged: number
}

export class LegalDocumentConflict extends Error {
  constructor(document: LoadedDocument) {
    super(
      `O documento ${document.kind}/${document.locale} v${document.version} mudou de conteúdo ` +
        'sem mudar de versão. Uma versão publicada é imutável: suba o número em ' +
        'packages/legal/src/registry.ts em vez de alterar a que já existe.',
    )
    this.name = 'LegalDocumentConflict'
  }
}

export async function syncLegalDocuments(
  db: Database,
  documents: readonly LoadedDocument[] = loadDocuments(),
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { inserted: [], unchanged: 0 }

  for (const document of documents) {
    const existing = await db
      .select({
        id: schema.legalDocuments.id,
        contentHash: schema.legalDocuments.contentHash,
      })
      .from(schema.legalDocuments)
      .where(
        and(
          eq(schema.legalDocuments.kind, document.kind),
          eq(schema.legalDocuments.locale, document.locale),
          eq(schema.legalDocuments.version, document.version),
        ),
      )
      .limit(1)

    const found = existing[0]
    if (found) {
      if (found.contentHash !== document.contentHash) throw new LegalDocumentConflict(document)
      outcome.unchanged++
      continue
    }

    await db.insert(schema.legalDocuments).values({
      kind: document.kind,
      locale: document.locale,
      version: document.version,
      title: document.title,
      body: document.body,
      contentHash: document.contentHash,
      ...(document.effective ? { effectiveAt: document.effective } : {}),
    })

    outcome.inserted.push({
      kind: document.kind,
      locale: document.locale,
      version: document.version,
    })
  }

  return outcome
}
