import { applyRetention, createDatabase, DEFAULT_RETENTION } from '@jellycare/db'
import { syncLegalDocuments } from '@jellycare/legal'
import { createBrowserPool } from './browser-pool.js'
import { MultiChannelNotifier, createReportSender } from './channels.js'
import { createCheckQueue, createCheckWorker } from './queues.js'
import { executeCheckJob } from './runner.js'
import { generatePendingReports, runReportRequests } from './report-jobs.js'
import { assertRedisReachable, redisConnection } from './redis-url.js'
import { sweepPendingVerifications } from './verification-jobs.js'
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

  // Publicar é fazer deploy: as versões novas dos documentos legais entram na
  // base de dados aqui, logo a seguir às migrações. No worker e não no
  // dashboard, pela mesma razão que as migrações: o dashboard pode ter várias
  // instâncias, e o worker tem uma.
  //
  // Se falhar, o arranque falha. Um conflito de versão significa que alguém
  // alterou um texto já aceite por um cliente, e continuar a correr com isso
  // por resolver é pior do que não arrancar.
  const documentos = await syncLegalDocuments(db)
  if (documentos.inserted.length > 0) {
    for (const documento of documentos.inserted) {
      console.info(
        `[legal] publicado ${documento.kind}/${documento.locale} v${documento.version}`,
      )
    }
  }

  const notifier = new MultiChannelNotifier({
    ...(process.env.RESEND_API_KEY ? { resendApiKey: process.env.RESEND_API_KEY } : {}),
    ...(process.env.ALERT_FROM_EMAIL ? { fromEmail: process.env.ALERT_FROM_EMAIL } : {}),
  })

  const queue = createCheckQueue(connection)
  const browsers = createBrowserPool()

  const worker = createCheckWorker({
    connection,
    concurrency: Number(process.env.JELLYCARE_CONCURRENCY ?? 5),
    // Afináveis por variável de ambiente porque quem paga o Redis ao comando
    // pode precisar de os mexer sem esperar por um deploy.
    ...(process.env.JELLYCARE_DRAIN_DELAY_SECONDS
      ? { drainDelaySeconds: Number(process.env.JELLYCARE_DRAIN_DELAY_SECONDS) }
      : {}),
    ...(process.env.JELLYCARE_STALLED_INTERVAL_MS
      ? { stalledIntervalMs: Number(process.env.JELLYCARE_STALLED_INTERVAL_MS) }
      : {}),
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
          ...(process.env.URLHAUS_AUTH_KEY
            ? { urlhausAuthKey: process.env.URLHAUS_AUTH_KEY }
            : {}),
          ...(process.env.WP_UMBRELLA_TOKEN
            ? { umbrellaToken: process.env.WP_UMBRELLA_TOKEN }
            : {}),
        },
        data,
      )
      if (outcome.status === 'skipped') {
        console.info(`[${data.checkType}] ${data.siteId}: ignorado — ${outcome.reason}`)
      }
      // Um check que corre com menos cobertura do que devia tem de aparecer a
      // quem opera a plataforma. Não é problema do cliente e não vira finding,
      // mas calar-se seria deixar a plataforma degradar-se em silêncio.
      for (const warning of outcome.status === 'completed' ? (outcome.warnings ?? []) : []) {
        console.warn(`[${data.checkType}] ${data.siteId}: ${warning}`)
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

  // Retenção. Diária e não horária: apaga por data de corte, por isso correr
  // mais vezes só multiplica varrimentos que não encontram nada. A política
  // está em `docs/riscos.md` e é condição para ligar clientes reais.
  const sweepRetention = async () => {
    try {
      const deleted = await applyRetention(db, DEFAULT_RETENTION)
      const total = Object.values(deleted).reduce((sum: number, n) => sum + Number(n), 0)
      // Só se escreve quando houve o que apagar: uma linha por dia a dizer
      // "apaguei zero" treina quem lê os logs a não os ler.
      if (total > 0) {
        console.info(`Retenção aplicada: ${JSON.stringify(deleted)}`)
      }
    } catch (error) {
      console.error('Falha ao aplicar a retenção:', error)
    }
  }

  const retentionTimer = setInterval(() => void sweepRetention(), 24 * 60 * 60_000)
  void sweepRetention()

  // Pedidos manuais do painel. De vinte em vinte segundos porque quem carregou
  // no botão está à espera: a passagem horária dos relatórios agendados serve
  // para o que é mensal, não para o que é "agora".
  const sweepRequests = async () => {
    try {
      const result = await runReportRequests(reportDeps)
      if (result.processed > 0) {
        console.info(`Pedidos de relatório executados: ${result.processed}.`)
      }
    } catch (error) {
      console.error('Falha ao executar pedidos de relatório:', error)
    }
  }

  const requestTimer = setInterval(() => void sweepRequests(), 20_000)

  // Verificação de propriedade, de hora a hora. É o que o painel promete a
  // quem publica o registo TXT ou o ficheiro e fecha a janela.
  async function sweepVerifications(): Promise<void> {
    try {
      const result = await sweepPendingVerifications({ db })
      if (result.verified > 0) {
        console.info(`Sites verificados: ${result.verified}.`)
      }
    } catch (error) {
      console.error('Falha na verificação de propriedade:', error)
    }
  }

  void sweepVerifications()
  const verificationTimer = setInterval(() => void sweepVerifications(), 60 * 60_000)
  void sweepRequests()

  console.info(`Worker Jellycare a correr na região ${region}.`)

  // Encerramento ordenado: um SIGTERM a meio de um deploy não pode deixar
  // findings por persistir nem jobs em estado indefinido.
  const shutdown = async (signal: string) => {
    console.info(`${signal} recebido, a encerrar.`)
    scheduler.stop()
    clearInterval(reportTimer)
    clearInterval(retentionTimer)
    clearInterval(verificationTimer)
    clearInterval(requestTimer)
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
