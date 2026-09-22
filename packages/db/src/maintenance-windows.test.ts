import { describe, expect, it } from 'vitest'
import {
  addMaintenanceWindow,
  isInAnyMaintenanceWindow,
  isInRecurringWindow,
  parseMaintenanceSchedule,
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

describe('isInRecurringWindow', () => {
  const noturna = {
    weekdays: [],
    hour: 3,
    minute: 0,
    durationMinutes: 120,
    timezone: 'Europe/Lisbon',
  }

  it('abre à hora certa no fuso declarado', () => {
    // 03:30 em Lisboa, no inverno, é 03:30 UTC.
    expect(isInRecurringWindow(noturna, new Date('2026-01-15T03:30:00Z'))).toBe(true)
    expect(isInRecurringWindow(noturna, new Date('2026-01-15T06:00:00Z'))).toBe(false)
  })

  it('segue a mudança da hora em vez de uma diferença fixa', () => {
    // No verão Lisboa está uma hora à frente de UTC: a mesma janela local das
    // 03:00 passa a começar às 02:00 UTC. Guardar o fuso e não a diferença é
    // o que faz «três da manhã» continuar a ser três da manhã.
    expect(isInRecurringWindow(noturna, new Date('2026-07-15T02:30:00Z'))).toBe(true)
    expect(isInRecurringWindow(noturna, new Date('2026-07-15T03:30:00Z'))).toBe(true)
    expect(isInRecurringWindow(noturna, new Date('2026-07-15T05:30:00Z'))).toBe(false)
  })

  it('atravessa a meia-noite', () => {
    const tarde = { ...noturna, hour: 23, minute: 0, durationMinutes: 180 }
    // 23:30 do dia 15 e 01:30 do dia 16, ambos dentro.
    expect(isInRecurringWindow(tarde, new Date('2026-01-15T23:30:00Z'))).toBe(true)
    expect(isInRecurringWindow(tarde, new Date('2026-01-16T01:30:00Z'))).toBe(true)
    expect(isInRecurringWindow(tarde, new Date('2026-01-16T02:30:00Z'))).toBe(false)
  })

  it('respeita os dias da semana, incluindo o que transita da noite anterior', () => {
    // 15/01/2026 é uma quinta-feira. Janela só às quintas, das 23h às 2h.
    const soQuinta = { ...noturna, weekdays: [4], hour: 23, minute: 0, durationMinutes: 180 }
    expect(isInRecurringWindow(soQuinta, new Date('2026-01-15T23:30:00Z'))).toBe(true)
    // 01:30 de sexta ainda pertence à janela que abriu na quinta.
    expect(isInRecurringWindow(soQuinta, new Date('2026-01-16T01:30:00Z'))).toBe(true)
    // Mas 23:30 de sexta já não.
    expect(isInRecurringWindow(soQuinta, new Date('2026-01-16T23:30:00Z'))).toBe(false)
  })

  it('não abre com fuso inválido', () => {
    // Uma configuração que não se entende não autoriza mexer no site de
    // ninguém: o lado seguro é não abrir.
    expect(
      isInRecurringWindow({ ...noturna, timezone: 'Nao/Existe' }, new Date('2026-01-15T03:30:00Z')),
    ).toBe(false)
  })

  it('não abre sem horário nenhum', () => {
    expect(isInRecurringWindow(null, AGORA)).toBe(false)
    expect(isInRecurringWindow({ ...noturna, durationMinutes: 0 }, AGORA)).toBe(false)
  })
})

describe('isInAnyMaintenanceWindow', () => {
  it('basta uma das duas vias', () => {
    const horario = {
      weekdays: [],
      hour: 3,
      minute: 0,
      durationMinutes: 60,
      timezone: 'Europe/Lisbon',
    }
    const momento = new Date('2026-01-15T03:30:00Z')

    expect(isInAnyMaintenanceWindow([], horario, momento)).toBe(true)
    expect(
      isInAnyMaintenanceWindow(
        [janela('2026-01-15T10:00:00Z', '2026-01-15T12:00:00Z')],
        null,
        new Date('2026-01-15T11:00:00Z'),
      ),
    ).toBe(true)
    expect(isInAnyMaintenanceWindow([], null, momento)).toBe(false)
  })
})

describe('parseMaintenanceSchedule', () => {
  const valido = { weekdays: [1, 3], hour: 3, minute: 0, durationMinutes: 120, timezone: 'Europe/Lisbon' }

  it('aceita e normaliza', () => {
    const resultado = parseMaintenanceSchedule({ ...valido, weekdays: [3, 1, 3, 9] })
    expect(resultado.error).toBeUndefined()
    // Ordenados, sem repetidos, e o 9 fora porque não é dia da semana.
    expect(resultado.schedule?.weekdays).toEqual([1, 3])
  })

  it('recusa hora, duração e fuso inválidos', () => {
    expect(parseMaintenanceSchedule({ ...valido, hour: 25 }).error).toContain('Hora')
    expect(parseMaintenanceSchedule({ ...valido, durationMinutes: 5 }).error).toContain('duração')
    expect(parseMaintenanceSchedule({ ...valido, timezone: 'Nao/Existe' }).error).toContain('Fuso')
  })
})
