import { describe, expect, it } from 'vitest'
import { checkJobId, checkWorkerSettings } from './queues.js'

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
