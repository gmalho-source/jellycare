import type { ConnectionOptions } from 'bullmq'

/**
 * Opções de ligação ao Redis a partir de um URL.
 *
 * O detalhe que interessa é o esquema. `rediss://`, com dois esses, significa
 * TLS obrigatório — é o que o Upstash e a maioria dos Redis geridos dão. Sem
 * ligar o TLS do lado do cliente a ligação é simplesmente recusada, e o worker
 * morre no arranque sem chegar a processar nada.
 */
export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url)

  const connection: {
    host: string
    port: number
    username?: string
    password?: string
    tls?: Record<string, never>
  } = {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
  }

  // O Upstash põe `default` como utilizador. O ioredis autentica com password
  // só, mas mandar o utilizador quando ele existe evita depender disso.
  if (parsed.username) connection.username = decodeURIComponent(parsed.username)
  if (parsed.password) connection.password = decodeURIComponent(parsed.password)
  if (parsed.protocol === 'rediss:') connection.tls = {}

  return connection
}
