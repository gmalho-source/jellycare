import { createDatabase } from '@jellycare/db'
import { createBrowserPool } from './browser-pool.js'
import { MultiChannelNotifier, createReportSender } from './channels.js'
import { createCheckQueue, createCheckWorker } from './queues.js'
import { executeCheckJob } from './runner.js'
import { generatePendingReports } from './report-jobs.js'
import { assertRedisReachable, redisConnection } from './redis-url.js'
import { startScheduler } from './scheduler.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variável de ambiente em falta: ${name}`)
  return value
}

async function main(): Promise<void> {
  const { db, close } = createDatabase({ url: required('DATABASE_URL') })
  const connection = redisConnection(required('REDIS_URL'))
  await assertRedisReachable(connection)
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
          ...(process.env.GOOGLE_SAFE_BROWSING_API_KEY
            ? { safeBrowsingApiKey: process.env.GOOGLE_SAFE_BROWSING_API_KEY }
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

  // Os relatórios não passam pelo agendador de verificações: não são
  // periódicos em minutos, são no dia N de cada mês. Esta passagem pergunta de
  // hora a hora o que falta, e o índice único por site e período torna-a
  // idempotente.
  const reportDeps = {
    db,
    browser: browsers.get,
    sendReport: createReportSender({
      ...(process.env.RESEND_API_KEY ? { resendApiKey: process.env.RESEND_API_KEY } : {}),
      ...(process.env.REPORT_FROM_EMAIL ? { fromEmail: process.env.REPORT_FROM_EMAIL } : {}),
    }),
  }

  const sweepReports = async () => {
    try {
      const result = await generatePendingReports(reportDeps)
      if (result.generated > 0) {
        console.info(`Relatórios gerados: ${result.generated}, enviados: ${result.sent}.`)
      }
    } catch (error) {
      console.error('Falha ao gerar relatórios:', error)
    }
  }

  const reportTimer = setInterval(() => void sweepReports(), 60 * 60_000)
  void sweepReports()

  console.info(`Worker Jellycare a correr na região ${region}.`)

  // Encerramento ordenado: um SIGTERM a meio de um deploy não pode deixar
  // findings por persistir nem jobs em estado indefinido.
  const shutdown = async (signal: string) => {
    console.info(`${signal} recebido, a encerrar.`)
    scheduler.stop()
    clearInterval(reportTimer)
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
