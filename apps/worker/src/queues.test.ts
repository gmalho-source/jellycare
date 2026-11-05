import { describe, expect, it } from 'vitest'
import {
  checkJobId,
  checkWorkerSettings,
  createCheckQueue,
  createCheckWorker,
  removeStaleUptimeQueues,
  uptimeQueueName,
} from './queues.js'
import { redisConnection } from './redis-url.js'

describe('checkJobId', () => {
  it('é o mesmo dentro do mesmo minuto e muda no minuto seguinte', () => {
    const data = { siteId: 'site-1', checkType: 'uptime' as const }
    const agora = new Date('2026-09-21T10:00:30Z')
    const mesmoMinuto = new Date('2026-09-21T10:00:59Z')
    const minutoSeguinte = new Date('2026-09-21T10:01:00Z')

    expect(checkJobId(data, agora)).toBe(checkJobId(data, mesmoMinuto))
    expect(checkJobId(data, agora)).not.toBe(checkJobId(data, minutoSeguinte))
  })
})

describe('checkWorkerSettings', () => {
  const base = { connection: {}, process: async () => ({}) }

  it('espera bloqueada durante um minuto em vez dos cinco segundos por omissão', () => {
    // O Upstash cobra ao comando. Com os cinco segundos do BullMQ, um worker
    // sem nada para fazer gastava 96 comandos por minuto — cerca de quatro
    // milhões por mês contra um plano gratuito de quinhentos mil. Medido, não
    // estimado: 60 segundos de worker parado contra um Redis local.
    expect(checkWorkerSettings(base).drainDelay).toBe(60)
  })

  it('procura jobs abandonados de cinco em cinco minutos', () => {
    expect(checkWorkerSettings(base).stalledInterval).toBe(300_000)
  })

  it('deixa afinar os intervalos sem tocar no código', () => {
    const afinado = checkWorkerSettings({
      ...base,
      drainDelaySeconds: 5,
      stalledIntervalMs: 30_000,
      concurrency: 2,
    })

    expect(afinado).toEqual({ drainDelay: 5, stalledInterval: 30_000, concurrency: 2 })
  })
})

describe('apanhar trabalho com a espera longa', () => {
  // A dúvida legítima sobre subir o `drainDelay` para 60 segundos é se um job
  // passa a esperar até um minuto para ser apanhado. Não passa — o `bzpopmin`
  // é bloqueante e devolve no instante em que chega trabalho — mas isso é uma
  // afirmação sobre o BullMQ, não sobre o nosso código, e o preço de estar
  // errado é a monitorização ficar lenta em silêncio. Por isso mede-se.
  it('apanha um job em menos de cinco segundos, não ao fim do minuto', async () => {
    const connection = redisConnection(process.env.TEST_REDIS_URL ?? 'redis://localhost:56379')
    const queue = createCheckQueue(connection)
    await queue.obliterate({ force: true })

    let apanhadoEm = 0
    const começou = Date.now()

    const worker = createCheckWorker({
      connection,
      concurrency: 1,
      process: async () => {
        apanhadoEm = Date.now() - começou
        return { status: 'ok' }
      },
    })

    try {
      // Esperar que o worker esteja mesmo à escuta antes de pôr o job na fila.
      // Senão mede-se o arranque e não a latência da espera bloqueante.
      await worker.waitUntilReady()
      await queue.add('check', { siteId: 'site-1', checkType: 'uptime' })

      await new Promise<void>((resolve, reject) => {
        const limite = setTimeout(() => reject(new Error('job nunca foi apanhado')), 20_000)
        worker.on('completed', () => {
          clearTimeout(limite)
          resolve()
        })
      })

      // Medido: 3 ms. A margem é larga de propósito — o que se quer provar é
      // que não há relação nenhuma com os 60 segundos da espera.
      expect(apanhadoEm).toBeLessThan(5_000)
    } finally {
      await worker.close()
      await queue.obliterate({ force: true })
      await queue.close()
    }
  }, 30_000)
})

describe('removeStaleUptimeQueues', () => {
  it('apaga as filas de uptime de regiões fora da lista e deixa as outras', async () => {
    const connection = redisConnection(process.env.TEST_REDIS_URL ?? 'redis://localhost:56379')
    const nomes = ['teste-limpa-fica', 'teste-limpa-sai']
    const filas = nomes.map((nome) => createCheckQueue(connection, uptimeQueueName(nome)))
    const principal = createCheckQueue(connection)
    try {
      for (const fila of filas) {
        await fila.add('uptime', { siteId: 's', checkType: 'uptime' }, { delay: 60_000 })
      }
      await principal.add('tls', { siteId: 'teste-limpa', checkType: 'tls' }, { jobId: 'teste-limpa-tls', delay: 60_000 })

      const apagadas = await removeStaleUptimeQueues(connection, ['teste-limpa-fica'], {
        regionPrefix: 'teste-limpa-',
      })

      expect(apagadas).toContain(uptimeQueueName('teste-limpa-sai'))
      expect(apagadas).not.toContain(uptimeQueueName('teste-limpa-fica'))
      expect(await filas[1]!.getJobCounts('delayed')).toEqual({ delayed: 0 })
      expect(await filas[0]!.getJobCounts('delayed')).toEqual({ delayed: 1 })
      // A fila principal nunca é tocada.
      expect(await principal.getJob('teste-limpa-tls')).toBeTruthy()
    } finally {
      await principal.remove('teste-limpa-tls').catch(() => {})
      await principal.close()
      for (const fila of filas) {
        await fila.obliterate({ force: true }).catch(() => {})
        await fila.close()
      }
    }
  })
})
