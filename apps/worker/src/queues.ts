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

export function createCheckQueue(connection: ConnectionOptions): Queue<CheckJobData> {
  return new Queue<CheckJobData>(CHECK_QUEUE_NAME, {
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

export interface CheckWorkerOptions {
  connection: ConnectionOptions
  /**
   * Jobs em paralelo. Baixo por omissão: cada job faz pedidos ao site de um
   * cliente, e a plataforma não deve ser a causa do problema que monitoriza.
   */
  concurrency?: number
  process: (data: CheckJobData, job: Job<CheckJobData>) => Promise<unknown>
}

export function createCheckWorker(options: CheckWorkerOptions): Worker<CheckJobData> {
  return new Worker<CheckJobData>(
    CHECK_QUEUE_NAME,
    async (job) => options.process(job.data, job),
    {
      connection: options.connection,
      prefix: QUEUE_PREFIX,
      concurrency: options.concurrency ?? 5,
    },
  )
}
