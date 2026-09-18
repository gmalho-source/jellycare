import { describe, expect, it } from 'vitest'
import { redisConnection } from './redis-url.js'

describe('redisConnection', () => {
  it('liga o TLS quando o esquema é rediss', () => {
    // O formato que o Upstash dá. Sem TLS do lado do cliente a ligação é
    // recusada e o worker morre no arranque.
    const connection = redisConnection(
      'rediss://default:segredo@eu2-abc-12345.upstash.io:6379',
    ) as Record<string, unknown>

    expect(connection.tls).toEqual({})
    expect(connection.host).toBe('eu2-abc-12345.upstash.io')
    expect(connection.port).toBe(6379)
    expect(connection.username).toBe('default')
    expect(connection.password).toBe('segredo')
  })

  it('não liga o TLS num redis local', () => {
    const connection = redisConnection('redis://localhost:56379') as Record<string, unknown>

    expect(connection.tls).toBeUndefined()
    expect(connection.port).toBe(56379)
    expect(connection.username).toBeUndefined()
    expect(connection.password).toBeUndefined()
  })

  it('assume a porta 6379 quando o URL não a traz', () => {
    const connection = redisConnection('rediss://default:x@host.upstash.io') as Record<
      string,
      unknown
    >

    expect(connection.port).toBe(6379)
  })

  it('descodifica uma password com caracteres especiais', () => {
    // Uma password com `/` ou `@` vem percent-encoded no URL; passá-la ao
    // driver sem descodificar autentica com a string errada.
    const connection = redisConnection('rediss://default:a%2Fb%40c@host.upstash.io') as Record<
      string,
      unknown
    >

    expect(connection.password).toBe('a/b@c')
  })
})
