import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { normalizeConnectionUrl } from './connection-url.js'
import * as schema from './schema.js'

export type Database = PostgresJsDatabase<typeof schema>

export interface DatabaseOptions {
  url: string
  /** O worker abre poucas ligações e longas; a web abre muitas e curtas. */
  maxConnections?: number
}

export function createDatabase(options: DatabaseOptions): {
  db: Database
  close: () => Promise<void>
} {
  const sql = postgres(normalizeConnectionUrl(options.url).url, {
    max: options.maxConnections ?? 10,
    // Datas sempre em UTC: um relatório mensal que muda de valores com a hora
    // de verão é um relatório em que ninguém confia.
    types: {},
    onnotice: () => {},
  })

  return {
    db: drizzle(sql, { schema }),
    close: () => sql.end({ timeout: 5 }),
  }
}
