import { createDatabase } from '@jellycare/db'
import { createBrowserPool } from './browser-pool.js'
import { MultiChannelNotifier } from './channels.js'
import { createCheckQueue, createCheckWorker } from './queues.js'
import { executeCheckJob } from './runner.js'
import { startScheduler } from './scheduler.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variável de ambiente em falta: ${name}`)
  return value
}

function redisConnection(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url)
  const connection: { host: string; port: number; password?: string } = {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
  }
  if (parsed.password) connection.password = parsed.password
  return connection
}

async function main(): Promise<void> {
  const { db, close } = createDatabase({ url: required('DATABASE_URL') })
  const connection = redisConnection(required('REDIS_URL'))
  const region = process.env.JELLYCARE_REGION ?? 'eu-west'

  const notifier = new MultiChannelNotifier({
    ...(process.env.RESEND_API_KEY ? { resendApiKey: process.env.RESEND_API_KEY } : {}),
    ...(process.env.ALERT_FROM_EMAIL ? { fromEmail: process.env.ALERT_FROM_EMAIL } : {}),
  })

  const queue = createCheckQueue(connection)
  const browsers = createBrowserPool()

  const worker = createCheckWorker({
    connection,
    concurrency: Number(process.env.JELLYCARE_CONCURRENCY ?? 5),
    process: async (data) => {
      const outcome = await executeCheckJob(
        {
          db,
          notifier,
          region,
          browser: browsers.get,
          ...(process.env.CANARY_EMAIL_DOMAIN
            ? { canaryDomain: process.env.CANARY_EMAIL_DOMAIN }
            : {}),
        },
        data,
      )
      if (outcome.status === 'skipped') {
        console.info(`[${data.checkType}] ${data.siteId}: ignorado — ${outcome.reason}`)
      }
      return outcome
    },
  })

  worker.on('failed', (job, error) => {
    console.error(`[${job?.data.checkType}] ${job?.data.siteId}: falhou — ${error.message}`)
  })

  const scheduler = startScheduler({
    db,
    queue,
    intervalMs: Number(process.env.JELLYCARE_SCHEDULER_INTERVAL_MS ?? 30_000),
    onError: (error) => console.error('Falha no agendador:', error),
  })

  console.info(`Worker Jellycare a correr na região ${region}.`)

  // Encerramento ordenado: um SIGTERM a meio de um deploy não pode deixar
  // findings por persistir nem jobs em estado indefinido.
  const shutdown = async (signal: string) => {
    console.info(`${signal} recebido, a encerrar.`)
    scheduler.stop()
    await worker.close()
    await browsers.close()
    await queue.close()
    await close()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error) => {
  console.error('O worker não conseguiu arrancar:', error)
  process.exit(1)
})
