import { describe, expect, it } from 'vitest'
import {
  batchDelayMs,
  computeNextRun,
  deterministicPhase,
  isDue,
  isInMaintenanceWindow,
  selectDue,
  type SchedulableCheck,
} from './schedule.js'

const NOW = new Date('2026-09-17T10:00:00Z')

function check(overrides: Partial<SchedulableCheck> = {}): SchedulableCheck {
  return {
    id: 'check-1',
    siteId: 'site-1',
    checkType: 'uptime',
    enabled: true,
    intervalMinutes: 60,
    nextRunAt: new Date('2026-09-17T09:00:00Z'),
    ...overrides,
  }
}

describe('deterministicPhase', () => {
  it('é estável para a mesma semente', () => {
    expect(deterministicPhase('site-1:uptime')).toBe(deterministicPhase('site-1:uptime'))
  })

  it('distribui sementes diferentes', () => {
    const phases = ['a', 'b', 'c', 'd', 'e'].map(deterministicPhase)
    expect(new Set(phases).size).toBe(5)
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0)
      expect(phase).toBeLessThan(1)
    }
  })
})

describe('computeNextRun', () => {
  it('fica perto do intervalo pedido', () => {
    const next = computeNextRun(
      { siteId: 'site-1', checkType: 'uptime', intervalMinutes: 60 },
      NOW,
    )
    const deltaMinutes = (next.getTime() - NOW.getTime()) / 60_000

    expect(deltaMinutes).toBeGreaterThan(53)
    expect(deltaMinutes).toBeLessThan(67)
  })

  it('dá a sites diferentes posições diferentes na hora', () => {
    // O que evita bater em dezenas de sites do mesmo alojamento no mesmo
    // segundo.
    const times = ['site-1', 'site-2', 'site-3', 'site-4'].map((siteId) =>
      computeNextRun({ siteId, checkType: 'uptime', intervalMinutes: 1440 }, NOW).getTime(),
    )

    expect(new Set(times).size).toBe(4)
  })

  it('mantém a posição do mesmo site entre execuções', () => {
    const first = computeNextRun({ siteId: 's', checkType: 'uptime', intervalMinutes: 60 }, NOW)
    const later = new Date(NOW.getTime() + 3_600_000)
    const second = computeNextRun({ siteId: 's', checkType: 'uptime', intervalMinutes: 60 }, later)

    expect(second.getTime() - later.getTime()).toBe(first.getTime() - NOW.getTime())
  })

  it('nunca encurta o intervalo para menos de metade', () => {
    for (const interval of [1, 5, 60, 1440]) {
      for (const siteId of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
        const next = computeNextRun({ siteId, checkType: 'x', intervalMinutes: interval }, NOW)
        const delta = next.getTime() - NOW.getTime()
        expect(delta).toBeGreaterThanOrEqual((interval * 60_000) / 2)
      }
    }
  })

  it('limita a dispersão em intervalos longos', () => {
    // Num check semanal, 10% seriam 17 horas de desvio — o teto evita isso.
    const next = computeNextRun(
      { siteId: 'site-1', checkType: 'broken_links', intervalMinutes: 60 * 24 * 7 },
      NOW,
    )
    const deltaMinutes = (next.getTime() - NOW.getTime()) / 60_000
    expect(Math.abs(deltaMinutes - 60 * 24 * 7)).toBeLessThanOrEqual(10)
  })
})

describe('isDue', () => {
  it('considera vencido o que já passou da hora', () => {
    expect(isDue(check(), NOW)).toBe(true)
  })

  it('não considera vencido o que ainda falta', () => {
    expect(isDue(check({ nextRunAt: new Date('2026-09-17T11:00:00Z') }), NOW)).toBe(false)
  })

  it('corre já um check nunca executado', () => {
    expect(isDue(check({ nextRunAt: null }), NOW)).toBe(true)
  })

  it('ignora checks desativados, mesmo vencidos', () => {
    expect(isDue(check({ enabled: false }), NOW)).toBe(false)
  })
})

describe('selectDue', () => {
  it('atende primeiro o que está mais atrasado', () => {
    const checks = [
      check({ id: 'recente', nextRunAt: new Date('2026-09-17T09:55:00Z') }),
      check({ id: 'antigo', nextRunAt: new Date('2026-09-17T08:00:00Z') }),
      check({ id: 'medio', nextRunAt: new Date('2026-09-17T09:00:00Z') }),
    ]

    // Sem esta ordem, um pico de trabalho deixaria sempre os mesmos para trás.
    expect(selectDue(checks, NOW, 10).map((c) => c.id)).toEqual(['antigo', 'medio', 'recente'])
  })

  it('coloca à cabeça os que nunca correram', () => {
    const checks = [check({ id: 'agendado' }), check({ id: 'novo', nextRunAt: null })]
    expect(selectDue(checks, NOW, 10)[0]?.id).toBe('novo')
  })

  it('respeita o limite do lote', () => {
    const checks = Array.from({ length: 20 }, (_, i) => check({ id: `c${i}` }))
    expect(selectDue(checks, NOW, 5)).toHaveLength(5)
  })
})

describe('isInMaintenanceWindow', () => {
  const windows = [{ start: '2026-09-17T09:00:00Z', end: '2026-09-17T11:00:00Z' }]

  it('reconhece que estamos dentro da janela', () => {
    expect(isInMaintenanceWindow(windows, NOW)).toBe(true)
  })

  it('reconhece que estamos fora', () => {
    expect(isInMaintenanceWindow(windows, new Date('2026-09-17T12:00:00Z'))).toBe(false)
  })

  it('ignora janelas mal formadas em vez de rebentar', () => {
    expect(isInMaintenanceWindow([{ start: 'ontem', end: 'amanhã' }], NOW)).toBe(false)
  })

  it('não há janelas, não há supressão', () => {
    expect(isInMaintenanceWindow([], NOW)).toBe(false)
  })
})

describe('batchDelayMs', () => {
  it('espalha o lote ao longo da janela', () => {
    expect(batchDelayMs(0, 4, 60_000)).toBe(0)
    expect(batchDelayMs(2, 4, 60_000)).toBe(30_000)
  })

  it('não atrasa um lote de um', () => {
    expect(batchDelayMs(0, 1, 60_000)).toBe(0)
  })
})
