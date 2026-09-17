import { createDatabase, type Database } from '@jellycare/db'

/**
 * Ligação partilhada entre pedidos.
 *
 * O Next recria módulos em desenvolvimento a cada alteração; sem o cache
 * global, cada recompilação abriria um novo pool e esgotaria as ligações do
 * Postgres em minutos.
 */
const globalForDb = globalThis as unknown as { jellycareDb?: Database }

export function getDb(): Database {
  if (!globalForDb.jellycareDb) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL não está definida')
    globalForDb.jellycareDb = createDatabase({ url, maxConnections: 5 }).db
  }
  return globalForDb.jellycareDb
}
