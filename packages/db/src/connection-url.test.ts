import { describe, expect, it } from 'vitest'
import { createDatabase } from './client.js'
import { normalizeConnectionUrl } from './connection-url.js'

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

describe('normalizeConnectionUrl', () => {
  it('retira o channel_binding que o Neon põe na string da consola', () => {
    const result = normalizeConnectionUrl(
      'postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    )

    expect(result.removed).toEqual(['channel_binding'])
    expect(result.url).not.toContain('channel_binding')
    // O sslmode tem de sobreviver: é ele que obriga a ligação a ser cifrada.
    expect(result.url).toContain('sslmode=require')
  })

  it('não mexe numa string que não tenha parâmetros de cliente', () => {
    const url = 'postgres://postgres@localhost:5432/jellycare?sslmode=require'

    expect(normalizeConnectionUrl(url)).toEqual({ url, removed: [] })
  })

  it('deixa passar os parâmetros que o driver sabe ler', () => {
    const url =
      'postgres://u:p@host/db?sslmode=verify-full&sslrootcert=system&target_session_attrs=read-write'

    expect(normalizeConnectionUrl(url).removed).toEqual([])
  })

  it('devolve uma string ilegível como está, para o erro vir do driver', () => {
    expect(normalizeConnectionUrl('isto-não-é-um-url')).toEqual({
      url: 'isto-não-é-um-url',
      removed: [],
    })
  })
})

describe('createDatabase', () => {
  it('liga-se apesar do channel_binding na string', async () => {
    // O caso real: sem a limpeza, o Postgres responde
    // `unrecognized configuration parameter "channel_binding"` e o arranque
    // falha. Vale a ligação verdadeira — é o servidor que recusa, não o driver.
    const url = new URL(TEST_DATABASE_URL)
    url.searchParams.set('channel_binding', 'require')

    const { db, close } = createDatabase({ url: url.toString(), maxConnections: 1 })

    try {
      const rows = await db.execute<{ ok: number }>('select 1 as ok')
      expect(rows[0]?.ok).toBe(1)
    } finally {
      await close()
    }
  })
})
