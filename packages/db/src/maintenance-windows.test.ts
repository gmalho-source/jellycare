import { describe, expect, it } from 'vitest'
import {
  addMaintenanceWindow,
  MAX_MAINTENANCE_WINDOWS,
  MAX_WINDOW_DAYS,
  pruneEndedWindows,
  removeMaintenanceWindow,
  windowState,
} from './maintenance-windows.js'

const AGORA = new Date('2026-09-22T10:00:00Z')

function janela(start: string, end: string) {
  return { start, end }
}

describe('addMaintenanceWindow', () => {
  it('aceita uma janela futura e normaliza para ISO em UTC', () => {
    const resultado = addMaintenanceWindow(
      [],
      { start: '2026-09-23T22:00:00+01:00', end: '2026-09-24T02:00:00+01:00' },
      AGORA,
    )
    expect(resultado.error).toBeUndefined()
    expect(resultado.windows).toEqual([
      janela('2026-09-23T21:00:00.000Z', '2026-09-24T01:00:00.000Z'),
    ])
  })

  it('recusa o fim antes do início', () => {
    const resultado = addMaintenanceWindow(
      [],
      { start: '2026-09-24T02:00:00Z', end: '2026-09-23T22:00:00Z' },
      AGORA,
    )
    expect(resultado.error).toContain('depois do início')
    expect(resultado.windows).toHaveLength(0)
  })

  it('recusa uma janela que já terminou', () => {
    // Declarar silêncio para ontem não silencia nada: só dá a impressão de
    // que se fez alguma coisa.
    const resultado = addMaintenanceWindow(
      [],
      { start: '2026-09-20T01:00:00Z', end: '2026-09-20T03:00:00Z' },
      AGORA,
    )
    expect(resultado.error).toContain('já terminou')
  })

  it('aceita uma janela a decorrer', () => {
    // Começou há uma hora e ainda não acabou: é exatamente quando alguém se
    // lembra de a declarar.
    const resultado = addMaintenanceWindow(
      [],
      { start: '2026-09-22T09:00:00Z', end: '2026-09-22T13:00:00Z' },
      AGORA,
    )
    expect(resultado.error).toBeUndefined()
    expect(resultado.windows).toHaveLength(1)
  })

  it('recusa uma janela mais longa do que o limite', () => {
    const resultado = addMaintenanceWindow(
      [],
      { start: '2026-09-23T00:00:00Z', end: '2026-10-20T00:00:00Z' },
      AGORA,
    )
    expect(resultado.error).toContain(`${MAX_WINDOW_DAYS} dias`)
    expect(resultado.error).toContain('pausa')
  })

  it('recusa datas que não são datas', () => {
    const resultado = addMaintenanceWindow([], { start: 'amanhã', end: 'logo' }, AGORA)
    expect(resultado.error).toBe('Datas inválidas.')
  })

  it('recusa a duplicada', () => {
    const existente = [janela('2026-09-23T22:00:00.000Z', '2026-09-24T02:00:00.000Z')]
    const resultado = addMaintenanceWindow(
      existente,
      { start: '2026-09-23T22:00:00Z', end: '2026-09-24T02:00:00Z' },
      AGORA,
    )
    expect(resultado.error).toContain('já está declarada')
    expect(resultado.windows).toHaveLength(1)
  })

  it('aceita janelas sobrepostas', () => {
    // Duas equipas a declarar trabalho na mesma noite não é um erro, e
    // recusar obrigava a segunda a apagar o trabalho da primeira.
    const existente = [janela('2026-09-23T22:00:00.000Z', '2026-09-24T02:00:00.000Z')]
    const resultado = addMaintenanceWindow(
      existente,
      { start: '2026-09-23T23:00:00Z', end: '2026-09-24T04:00:00Z' },
      AGORA,
    )
    expect(resultado.error).toBeUndefined()
    expect(resultado.windows).toHaveLength(2)
  })

  it('devolve a lista por ordem de início', () => {
    const existente = [janela('2026-09-25T00:00:00.000Z', '2026-09-25T02:00:00.000Z')]
    const resultado = addMaintenanceWindow(
      existente,
      { start: '2026-09-23T00:00:00Z', end: '2026-09-23T02:00:00Z' },
      AGORA,
    )
    expect(resultado.windows.map((w) => w.start)).toEqual([
      '2026-09-23T00:00:00.000Z',
      '2026-09-25T00:00:00.000Z',
    ])
  })

  it('para no limite de janelas', () => {
    const existente = Array.from({ length: MAX_MAINTENANCE_WINDOWS }, (_, i) =>
      janela(
        `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        `2026-10-${String(i + 1).padStart(2, '0')}T02:00:00.000Z`,
      ),
    )
    const resultado = addMaintenanceWindow(
      existente,
      { start: '2026-11-01T00:00:00Z', end: '2026-11-01T02:00:00Z' },
      AGORA,
    )
    expect(resultado.error).toContain(String(MAX_MAINTENANCE_WINDOWS))
    expect(resultado.windows).toHaveLength(MAX_MAINTENANCE_WINDOWS)
  })

  it('limpa as janelas velhas ao escrever, mas guarda a de ontem', () => {
    // A de ontem explica porque não houve alerta ontem, e isso pergunta-se.
    const existente = [
      janela('2026-06-01T00:00:00.000Z', '2026-06-01T02:00:00.000Z'),
      janela('2026-09-21T00:00:00.000Z', '2026-09-21T02:00:00.000Z'),
    ]
    const resultado = addMaintenanceWindow(
      existente,
      { start: '2026-09-23T00:00:00Z', end: '2026-09-23T02:00:00Z' },
      AGORA,
    )
    expect(resultado.windows.map((w) => w.start)).toEqual([
      '2026-09-21T00:00:00.000Z',
      '2026-09-23T00:00:00.000Z',
    ])
  })
})

describe('pruneEndedWindows', () => {
  it('descarta o que tem datas inválidas', () => {
    expect(pruneEndedWindows([janela('x', 'y')], AGORA)).toHaveLength(0)
  })
})

describe('removeMaintenanceWindow', () => {
  it('remove a janela exata e deixa as outras', () => {
    const existente = [
      janela('2026-09-23T00:00:00.000Z', '2026-09-23T02:00:00.000Z'),
      janela('2026-09-25T00:00:00.000Z', '2026-09-25T02:00:00.000Z'),
    ]
    const restantes = removeMaintenanceWindow(existente, existente[0]!)
    expect(restantes).toEqual([existente[1]])
  })
})

describe('windowState', () => {
  it('distingue agendada, a decorrer e terminada', () => {
    expect(windowState(janela('2026-09-23T00:00:00Z', '2026-09-23T02:00:00Z'), AGORA)).toBe(
      'agendada',
    )
    expect(windowState(janela('2026-09-22T09:00:00Z', '2026-09-22T11:00:00Z'), AGORA)).toBe(
      'a decorrer',
    )
    expect(windowState(janela('2026-09-21T09:00:00Z', '2026-09-21T11:00:00Z'), AGORA)).toBe(
      'terminada',
    )
  })
})
