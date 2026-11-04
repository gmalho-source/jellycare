import { applyRetention, createDatabase, DEFAULT_RETENTION } from '@jellycare/db'
import { syncLegalDocuments } from '@jellycare/legal'
import { ensureCheckConfigs } from './check-configs.js'
import { createBrowserPool } from './browser-pool.js'
import { createThrottledLogger, errorKey } from './log-throttle.js'
import { MultiChannelNotifier, createReportSender } from './channels.js'
import { createCheckQueue, createCheckWorker, uptimeQueueName, type CheckWorkerOptions } from './queues.js'
import { resolveTopology } from './regions.js'
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
  // Que região é esta e que papel tem. Ver `regions.ts`.
  const topology = resolveTopology(process.env)
  const { region } = topology

  // Publicar é fazer deploy: as versões novas dos documentos legais entram na
  // base de dados aqui, logo a seguir às migrações. No worker e não no
  // dashboard, pela mesma razão que as migrações: o dashboard pode ter várias
  // instâncias, e o worker tem uma.
  //
  // Se falhar, o arranque falha. Um conflito de versão significa que alguém
  // alterou um texto já aceite por um cliente, e continuar a correr com isso
  // por resolver é pior do que não arrancar.
  // Verificações acrescentadas depois de um site ser criado nunca lhe
  // chegavam: sem linha de configuração, o agendador não as vê e elas nunca
  // correm — em silêncio. Aconteceu com o inventário WordPress.
  // Só a região principal escreve configuração e documentos: as probes de
  // disponibilidade das outras regiões leem a mesma base de dados e não têm
  // nada a acrescentar-lhe.
  if (topology.primary) {
    const configuracoes = await ensureCheckConfigs(db)
    if (configuracoes.created > 0) {
      console.info(`[checks] ${configuracoes.created} configurações em falta criadas`)
    }

    const documentos = await syncLegalDocuments(db)
    if (documentos.inserted.length > 0) {
      for (const documento of documentos.inserted) {
        console.info(
          `[legal] publicado ${documento.kind}/${documento.locale} v${documento.version}`,
        )
      }
    }
  }

  const notifier = new MultiChannelNotifier({
    ...(process.env.RESEND_API_KEY ? { resendApiKey: process.env.RESEND_API_KEY } : {}),
    ...(process.env.ALERT_FROM_EMAIL ? { fromEmail: process.env.ALERT_FROM_EMAIL } : {}),
  })

  // A fila principal só existe na região principal: é lá que o agendador
  // enfileira. As filas de disponibilidade por região, só com várias regiões.
  const queue = topology.primary ? createCheckQueue(connection) : null
  const uptimeQueues =
    topology.primary && topology.multiRegion
      ? topology.regions.map((nome) => createCheckQueue(connection, uptimeQueueName(nome)))
      : []
  const browsers = createBrowserPool()

  const workerOptions: CheckWorkerOptions = {
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
          ...(process.env.URLHAUS_AUTH_KEY
            ? { urlhausAuthKey: process.env.URLHAUS_AUTH_KEY }
            : {}),
          ...(process.env.WEB_RISK_API_KEY
            ? { webRiskApiKey: process.env.WEB_RISK_API_KEY }
            : {}),
          ...(process.env.WP_UMBRELLA_TOKEN
            ? { umbrellaToken: process.env.WP_UMBRELLA_TOKEN }
            : {}),
          ...(process.env.GOOGLE_PAGESPEED_API_KEY
            ? { pageSpeedApiKey: process.env.GOOGLE_PAGESPEED_API_KEY }
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
  }

  // A principal lê a fila de todas as verificações; cada região, com várias,
  // lê também a sua fila de disponibilidade. Uma probe secundária só lê a sua.
  const workers = [
    ...(topology.primary ? [createCheckWorker(workerOptions)] : []),
    ...(topology.multiRegion
      ? [createCheckWorker({ ...workerOptions, queueName: uptimeQueueName(region) })]
      : []),
  ]

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      console.error(`[${job?.data.checkType}] ${job?.data.siteId}: falhou — ${error.message}`)
    })
  }

  /**
   * Os erros de infraestrutura, estrangulados.
   *
   * Quando o Redis recusa, recusa *tudo*, e a mesma linha repete-se milhares
   * de vezes por minuto. A primeira sai na hora; as iguais são contadas e a
   * contagem sai com a seguinte. Ver `log-throttle.ts`.
   */
  const infra = createThrottledLogger()

  // A fila e o worker são EventEmitters e não tinham ouvinte de `error`.
  // Sem ouvinte, cada falha de ligação chega ao Node em bruto, com a pilha
  // inteira — foi assim que dezoito horas de Redis recusado deram catorze
  // milhões de linhas. E um `error` sem ouvinte num EventEmitter é, por
  // omissão, uma exceção que derruba o processo.
  for (const fila of [...(queue ? [queue] : []), ...uptimeQueues]) {
    fila.on('error', (error) => infra.error(errorKey('Erro da fila', error), error))
  }
  for (const worker of workers) {
    worker.on('error', (error) => infra.error(errorKey('Erro do worker', error), error))
  }

  // O agendador, os relatórios, a retenção, os pedidos do painel e a
  // verificação de propriedade: tudo só na região principal. Duas cópias
  // destes ciclos a correr ao mesmo tempo era enfileirar e gerar a dobrar.
  const timers: ReturnType<typeof setInterval>[] = []
  let stopScheduler = () => {}

  if (queue) {
    const scheduler = startScheduler({
      db,
      queue,
      uptimeQueues,
      intervalMs: Number(process.env.JELLYCARE_SCHEDULER_INTERVAL_MS ?? 30_000),
      onError: (error) => infra.error(errorKey('Falha no agendador', error), error),
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

    timers.push(reportTimer, retentionTimer, requestTimer, verificationTimer)
    stopScheduler = () => scheduler.stop()
  }

  console.info(
    topology.primary
      ? `Worker Jellycare a correr na região ${region}.`
      : `Probe de disponibilidade Jellycare a correr na região ${region}.`,
  )

  // Encerramento ordenado: um SIGTERM a meio de um deploy não pode deixar
  // findings por persistir nem jobs em estado indefinido.
  const shutdown = async (signal: string) => {
    console.info(`${signal} recebido, a encerrar.`)
    stopScheduler()
    for (const timer of timers) clearInterval(timer)
    await Promise.all(workers.map((worker) => worker.close()))
    await browsers.close()
    await Promise.all([...(queue ? [queue] : []), ...uptimeQueues].map((fila) => fila.close()))
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
