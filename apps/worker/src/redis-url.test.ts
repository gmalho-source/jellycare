import { describe, expect, it } from 'vitest'
import { assertRedisReachable, redisConnection } from './redis-url.js'

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

describe('redisConnection com valor inválido', () => {
  it('não deixa a password ir para a mensagem de erro', () => {
    // O caso real: foi colada a linha de comando inteira do Upstash em vez do
    // endereço. O erro nativo do `new URL` traz a string toda, password
    // incluída, e o Fly guarda isso no log.
    const comando =
      'redis-cli --tls -u redis://default:PASSWORD-SECRETA@host.upstash.io:6379'

    let mensagem = ''
    try {
      redisConnection(comando)
    } catch (error) {
      mensagem = error instanceof Error ? error.message : String(error)
    }

    expect(mensagem).toContain('REDIS_URL')
    expect(mensagem).not.toContain('PASSWORD-SECRETA')
    // Nada do valor recebido é devolvido: nem a password, nem o host, nem a
    // string original. A mensagem diz o formato esperado e mais nada.
    expect(mensagem).not.toContain('host.upstash.io')
    expect(mensagem).not.toContain(comando)
  })
})

describe('assertRedisReachable', () => {
  it('passa contra um Redis que responde', async () => {
    const url = process.env.TEST_REDIS_URL ?? 'redis://localhost:56379'

    await expect(assertRedisReachable(redisConnection(url), 5_000)).resolves.toBeUndefined()
  })

  it('rebenta depressa quando não há ninguém a atender, e diz o que verificar', async () => {
    // O caso real: um REDIS_URL sem credenciais nem TLS. Antes disto o worker
    // anunciava-se e ficava calado para sempre; agora morre e o Fly reinicia,
    // com o motivo no log.
    const morto = redisConnection('redis://127.0.0.1:1')

    await expect(assertRedisReachable(morto, 2_000)).rejects.toThrow(/REDIS_URL/)
  }, 15_000)
})
