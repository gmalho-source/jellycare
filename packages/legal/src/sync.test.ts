import { createDatabase, schema, type Database } from '@jellycare/db'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadDocuments, sha256 } from './load.js'
import { LEGAL_DOCUMENTS, ACCEPTANCE_REQUIRED } from './registry.js'
import { LegalDocumentConflict, syncLegalDocuments } from './sync.js'

describe('registo de documentos', () => {
  it('lê do disco todos os documentos declarados', () => {
    const documentos = loadDocuments()
    expect(documentos).toHaveLength(LEGAL_DOCUMENTS.length)
    for (const documento of documentos) {
      expect(documento.body.length).toBeGreaterThan(200)
      expect(documento.contentHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('não declara dois documentos com a mesma chave', () => {
    const chaves = LEGAL_DOCUMENTS.map((d) => `${d.kind}/${d.locale}/${d.version}`)
    expect(new Set(chaves).size).toBe(chaves.length)
  })

  it('exige aceitação apenas de tipos que têm documento', () => {
    // Exigir a aceitação de um documento que não existe bloqueava a
    // organização num ecrã sem nada para ler.
    for (const kind of ACCEPTANCE_REQUIRED) {
      expect(LEGAL_DOCUMENTS.some((d) => d.kind === kind)).toBe(true)
    }
  })

  it('o DPA aponta para a lista de subcontratantes em vez de a copiar', () => {
    // Duas cópias da lista divergem, e ambas seriam contratuais. O anexo
    // remete para o documento próprio, que é o que o pré-aviso de 30 dias
    // consegue versionar.
    const pt = loadDocuments(LEGAL_DOCUMENTS.filter((d) => d.kind === 'dpa' && d.locale === 'pt'))
    expect(pt[0]!.body).toContain('/legal/subcontratantes')
    expect(pt[0]!.body).not.toContain('| **Fly.io**')
  })
})

const DATABASE_URL = process.env.TEST_DATABASE_URL
const describeDb = DATABASE_URL ? describe : describe.skip

describeDb('sincronização', () => {
  let db: Database
  let close: () => Promise<void>

  beforeAll(async () => {
    const created = createDatabase({ url: DATABASE_URL as string, maxConnections: 2 })
    db = created.db
    close = created.close
  })

  afterAll(async () => {
    await close()
  })

  // Uma versão alta e própria deste teste, para não colidir com o que a
  // aplicação publica nem com outro pacote a correr ao mesmo tempo contra a
  // mesma base de dados.
  const versao = 900_000 + Math.floor(Math.random() * 90_000)
  const doc = (body: string) => [
    {
      kind: 'terms' as const,
      locale: 'pt' as const,
      version: versao,
      title: 'Teste',
      file: 'irrelevante.md',
      body,
      contentHash: sha256(body),
      effective: null,
    },
  ]

  it('insere o que falta e não repete o que já existe', async () => {
    const primeira = await syncLegalDocuments(db, doc('texto original'))
    expect(primeira.inserted).toHaveLength(1)

    const segunda = await syncLegalDocuments(db, doc('texto original'))
    expect(segunda.inserted).toHaveLength(0)
    expect(segunda.unchanged).toBe(1)

    const linhas = await db
      .select()
      .from(schema.legalDocuments)
      .where(
        and(
          eq(schema.legalDocuments.kind, 'terms'),
          eq(schema.legalDocuments.version, versao),
        ),
      )
    expect(linhas).toHaveLength(1)
  })

  it('recusa reescrever uma versão já publicada', async () => {
    // É a propriedade que protege a prova: a linha que um cliente aceitou
    // não pode passar a dizer outra coisa.
    await syncLegalDocuments(db, doc('texto original'))
    await expect(syncLegalDocuments(db, doc('texto alterado à socapa'))).rejects.toBeInstanceOf(
      LegalDocumentConflict,
    )

    const linhas = await db
      .select({ body: schema.legalDocuments.body })
      .from(schema.legalDocuments)
      .where(
        and(
          eq(schema.legalDocuments.kind, 'terms'),
          eq(schema.legalDocuments.version, versao),
        ),
      )
    expect(linhas[0]?.body).toBe('texto original')
  })
})
