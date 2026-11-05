import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { CheckJobData } from './runner.js'

// O BullMQ rejeita ":" em nomes de fila e em ids de job — o namespace vai no
// `prefix`, não no nome.
export const QUEUE_PREFIX = 'jellycare'
export const CHECK_QUEUE_NAME = 'checks'

/**
 * Identificador determinístico do job.
 *
 * O BullMQ ignora um job cujo id já esteja em fila. Como o id inclui a janela
 * de agendamento, um scheduler que corra duas vezes — ou dois schedulers em
 * simultâneo durante um deploy — não duplica trabalho contra o site do cliente.
 */
export function checkJobId(data: CheckJobData, scheduledFor: Date): string {
  const slot = Math.floor(scheduledFor.getTime() / 60_000)
  return `${data.siteId}-${data.checkType}-${slot}`
}

/**
 * A fila de disponibilidade de uma região, quando há mais do que uma.
 *
 * Cada região lê só a sua: é assim que cada verificação de uptime corre em
 * todas as regiões, e não numa delas ao acaso. Ver `regions.ts`.
 */
export function uptimeQueueName(region: string): string {
  return `uptime-${region}`
}

export function createCheckQueue(
  connection: ConnectionOptions,
  name: string = CHECK_QUEUE_NAME,
): Queue<CheckJobData> {
  return new Queue<CheckJobData>(name, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 3,
      // Uma falha costuma ser transitória; insistir de imediato só repete o
      // erro e sobrecarrega o site.
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 24 * 3600, count: 5_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  })
}

/**
 * Quanto tempo o worker fica bloqueado à espera de trabalho antes de repetir
 * o pedido ao Redis.
 *
 * O BullMQ usa por omissão cinco segundos, e isso pressupõe um Redis que se
 * possui: reabrir a espera doze vezes por minuto não custa nada. O Upstash
 * cobra ao comando, e medimos o que isso dá — um worker parado, sem um único
 * job para processar, gastava 96 comandos por minuto, ou cerca de quatro
 * milhões por mês. O plano gratuito tem quinhentos mil.
 *
 * Esperar sessenta segundos não atrasa nada: o `bzpopmin` é bloqueante e
 * devolve no instante em que chega um job. O que muda é só a frequência com
 * que a espera é reaberta quando não chega nada.
 */
const DRAIN_DELAY_SECONDS = 60

/**
 * De quanto em quanto tempo se procuram jobs abandonados.
 *
 * Um job fica "stalled" quando o worker morre a meio. Trinta segundos — a
 * omissão — é um desperdício aqui: os checks correm de cinco em cinco minutos
 * no melhor dos casos, e recuperar um job abandonado cinco minutos depois não
 * muda nada para o cliente.
 */
const STALLED_INTERVAL_MS = 300_000

export interface CheckWorkerOptions {
  connection: ConnectionOptions
  /** A fila de onde lê. Por omissão, a fila principal das verificações. */
  queueName?: string
  /**
   * Jobs em paralelo. Baixo por omissão: cada job faz pedidos ao site de um
   * cliente, e a plataforma não deve ser a causa do problema que monitoriza.
   */
  concurrency?: number
  /** Segundos de espera bloqueante. Ver `DRAIN_DELAY_SECONDS`. */
  drainDelaySeconds?: number
  /** Intervalo da procura de jobs abandonados. Ver `STALLED_INTERVAL_MS`. */
  stalledIntervalMs?: number
  process: (data: CheckJobData, job: Job<CheckJobData>) => Promise<unknown>
}

/** As opções que o worker passa ao BullMQ, à parte para o teste as poder ler. */
export function checkWorkerSettings(options: CheckWorkerOptions): {
  concurrency: number
  drainDelay: number
  stalledInterval: number
} {
  return {
    concurrency: options.concurrency ?? 5,
    drainDelay: options.drainDelaySeconds ?? DRAIN_DELAY_SECONDS,
    stalledInterval: options.stalledIntervalMs ?? STALLED_INTERVAL_MS,
  }
}

export function createCheckWorker(options: CheckWorkerOptions): Worker<CheckJobData> {
  return new Worker<CheckJobData>(
    options.queueName ?? CHECK_QUEUE_NAME,
    async (job) => options.process(job.data, job),
    {
      connection: options.connection,
      prefix: QUEUE_PREFIX,
      ...checkWorkerSettings(options),
    },
  )
}

/**
 * Apaga as filas de disponibilidade de regiões que deixaram de existir.
 *
 * Quando uma região sai de `JELLYCARE_REGIONS` — ou nunca chegou a ter
 * máquina, como Madrid, que o Fly descontinuou entre o deploy da
 * configuração e a criação da probe —, os jobs que já estavam na fila dela
 * não têm quem os leia. Ficavam no Redis para sempre, a ocupar memória que o
 * Upstash cobra. Corre no arranque da região principal; com uma região só
 * apaga também as filas de uptime que tenham sobrado de quando havia várias.
 *
 * Encontra as filas pelas chaves (`jellycare:uptime-<região>:...`) com SCAN,
 * que não bloqueia o Redis. Uma passagem por arranque, umas dezenas de
 * comandos: nada ao lado do que o worker gasta num minuto.
 *
 * Devolve os nomes das filas apagadas.
 */
export async function removeStaleUptimeQueues(
  connection: ConnectionOptions,
  keep: readonly string[],
  /** Restringe a procura a regiões com este prefixo. Existe para os testes. */
  options: { regionPrefix?: string } = {},
): Promise<string[]> {
  const { Redis } = await import('ioredis')
  const redis = new Redis({ ...(connection as Record<string, unknown>), lazyConnect: true })
  redis.on('error', () => {})

  const manter = new Set(keep.map(uptimeQueueName))
  const encontradas = new Set<string>()
  const prefixo = `${QUEUE_PREFIX}:${uptimeQueueName(options.regionPrefix ?? '')}`

  try {
    await redis.connect()
    let cursor = '0'
    do {
      const [proximo, chaves] = await redis.scan(cursor, 'MATCH', `${prefixo}*`, 'COUNT', 500)
      cursor = proximo
      for (const chave of chaves) {
        // `jellycare:uptime-eu-south:delayed` → `uptime-eu-south`. Os nomes
        // das regiões não têm `:`, por isso o segundo segmento é o da fila.
        const nome = chave.split(':')[1]
        if (nome && !manter.has(nome)) encontradas.add(nome)
      }
    } while (cursor !== '0')
  } finally {
    redis.disconnect()
  }

  const apagadas: string[] = []
  for (const nome of encontradas) {
    const fila = new Queue(nome, { connection, prefix: QUEUE_PREFIX })
    try {
      await fila.obliterate({ force: true })
      apagadas.push(nome)
    } finally {
      await fila.close()
    }
  }
  return apagadas.sort()
}
