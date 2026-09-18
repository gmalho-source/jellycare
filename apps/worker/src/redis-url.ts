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

/**
 * Confirma que o Redis responde, antes de o worker dizer que está a correr.
 *
 * Sem isto a falha é silenciosa e é a pior de todas: o ioredis reconecta para
 * sempre, o `queue.add` do agendador fica pendurado à espera de uma ligação
 * que nunca vem, e o worker anuncia-se no arranque e nunca mais escreve nada.
 * Máquina viva, zero trabalho feito, zero erros. Numa plataforma que existe
 * para dar por falhas alheias, é inaceitável não dar pelas próprias.
 *
 * Rebentar é a resposta certa: o Fly reinicia a máquina e o erro fica no log.
 */
export async function assertRedisReachable(
  connection: ConnectionOptions,
  timeoutMs = 10_000,
): Promise<void> {
  const { Redis } = await import('ioredis')
  const probe = new Redis({
    ...(connection as Record<string, unknown>),
    lazyConnect: true,
    connectTimeout: timeoutMs,
    maxRetriesPerRequest: 1,
    // Sem isto, uma ligação recusada volta a ser tentada indefinidamente e a
    // sonda nunca devolve — exatamente o problema que ela existe para evitar.
    retryStrategy: () => null,
  })

  // O erro chega por `connect()`; sem este ouvinte o ioredis ainda o emite
  // como evento não tratado e suja o log com a mesma informação duas vezes.
  probe.on('error', () => {})

  try {
    await probe.connect()
    await probe.ping()
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Não foi possível ligar ao Redis: ${motivo}. Confirme o REDIS_URL — ` +
        'o Upstash exige o formato rediss://default:<password>@<host>:6379, ' +
        'com TLS e credenciais.',
    )
  } finally {
    probe.disconnect()
  }
}
