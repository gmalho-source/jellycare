import type { CheckCapture } from '@jellycare/core'
import { eq, sql } from 'drizzle-orm'
import type { Database } from './client.js'
import { siteScreenshots } from './schema.js'

/** A fonte que manda: a imagem de computador cabe num cartão deitado. */
export const CAPTURA_PREFERIDA = 'page_speed_desktop'

/**
 * Guarda a imagem da homepage tirada por uma medição.
 *
 * A de computador substitui sempre. A de telemóvel só entra se ainda não
 * houver nenhuma, ou se a que há também for de telemóvel: trocar uma imagem
 * deitada por uma em pé a cada medição fazia o cartão mudar de forma todos os
 * dias.
 */
export async function guardarCaptura(
  db: Database,
  { siteId, source, capture, now }: { siteId: string; source: string; capture: CheckCapture; now: Date },
): Promise<boolean> {
  const valores = {
    siteId,
    source,
    mimeType: capture.mimeType,
    image: capture.data,
    capturedAt: now,
  }
  const substitui =
    source === CAPTURA_PREFERIDA
      ? sql`true`
      : sql`${siteScreenshots.source} <> ${CAPTURA_PREFERIDA}`

  const linhas = await db
    .insert(siteScreenshots)
    .values(valores)
    .onConflictDoUpdate({
      target: siteScreenshots.siteId,
      set: { source, mimeType: capture.mimeType, image: capture.data, capturedAt: now },
      setWhere: substitui,
    })
    .returning({ siteId: siteScreenshots.siteId })
  return linhas.length > 0
}

export async function lerCaptura(
  db: Database,
  siteId: string,
): Promise<{ mimeType: string; image: Buffer; capturedAt: Date } | null> {
  const [linha] = await db
    .select({
      mimeType: siteScreenshots.mimeType,
      image: siteScreenshots.image,
      capturedAt: siteScreenshots.capturedAt,
    })
    .from(siteScreenshots)
    .where(eq(siteScreenshots.siteId, siteId))
    .limit(1)
  return linha ?? null
}
