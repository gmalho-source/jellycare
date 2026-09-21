import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGAL_DOCUMENTS, type LegalDocumentSpec } from './registry.js'

/**
 * Ler os documentos do disco e apurar o resumo criptográfico de cada um.
 *
 * Só corre onde há sistema de ficheiros e apenas na sincronização — o
 * dashboard lê sempre da base de dados. Foi decisão deliberada: o `next
 * build` traça as importações e não copia ficheiros lidos em tempo de
 * execução, e um documento legal que desaparece da imagem de produção é uma
 * página de erro no sítio onde o cliente devia estar a ler o contrato.
 */

export interface LoadedDocument extends LegalDocumentSpec {
  body: string
  contentHash: string
  effective: Date | null
}

function documentsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'documents')
}

export function sha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

export function loadDocuments(specs: readonly LegalDocumentSpec[] = LEGAL_DOCUMENTS): LoadedDocument[] {
  const dir = documentsDir()

  return specs.map((spec) => {
    const body = readFileSync(resolve(dir, spec.file), 'utf8')
    return {
      ...spec,
      body,
      contentHash: sha256(body),
      effective: spec.effectiveAt ? new Date(spec.effectiveAt) : null,
    }
  })
}
