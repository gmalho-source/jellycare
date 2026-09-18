/**
 * Aplicação de migrações em produção.
 *
 * Usa o migrador do Drizzle em vez do `drizzle-kit`: o kit é uma dependência
 * de desenvolvimento e não vai na imagem de produção. O migrador toma um
 * bloqueio consultivo no Postgres, por isso duas instâncias a arrancar ao mesmo
 * tempo não aplicam a mesma migração duas vezes.
 *
 *   DATABASE_URL=... node dist/migrate.js
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

export interface MigrateOptions {
  databaseUrl: string
  /** Pasta das migrações. Por omissão, a que vai ao lado do código compilado. */
  migrationsFolder?: string
}

export async function runMigrations(options: MigrateOptions): Promise<void> {
  const folder =
    options.migrationsFolder ??
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

  // `max: 1` porque o migrador precisa de uma ligação única para o bloqueio.
  const sql = postgres(options.databaseUrl, { max: 1, onnotice: () => {} })

  try {
    await migrate(drizzle(sql), { migrationsFolder: folder })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const isDirectRun =
  process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')

if (isDirectRun) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL não está definida.')
    process.exit(1)
  }

  runMigrations({ databaseUrl })
    .then(() => {
      console.info('Migrações aplicadas.')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Falha ao aplicar migrações:', error)
      process.exit(1)
    })
}
