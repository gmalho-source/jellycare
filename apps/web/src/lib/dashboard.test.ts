import { describe, expect, it } from 'vitest'
import { dailyUptime } from './dashboard'

const INICIO = new Date('2026-09-01T00:00:00Z')
const FIM = new Date('2026-09-03T23:59:59Z')

function amostra(iso: string, up: boolean) {
  return { observedAt: new Date(iso), up }
}

describe('dailyUptime', () => {
  it('um dia sem observações fica a nulo e não a zero', () => {
    // Zero significa "esteve em baixo o dia todo" e é a afirmação mais grave
    // que este painel pode fazer. Não se diz isso por não termos olhado.
    const dias = dailyUptime([amostra('2026-09-02T10:00:00Z', true)], INICIO, FIM)

    expect(dias.find((d) => d.day === '2026-09-01')?.percent).toBeNull()
    expect(dias.find((d) => d.day === '2026-09-02')?.percent).toBe(100)
  })

  it('calcula a percentagem do dia a partir das observações desse dia', () => {
    const dias = dailyUptime(
      [
        amostra('2026-09-02T01:00:00Z', true),
        amostra('2026-09-02T02:00:00Z', true),
        amostra('2026-09-02T03:00:00Z', false),
        amostra('2026-09-02T04:00:00Z', true),
      ],
      INICIO,
      FIM,
    )

    const dia = dias.find((d) => d.day === '2026-09-02')
    expect(dia).toMatchObject({ up: 3, total: 4 })
    expect(dia?.percent).toBe(75)
  })

  it('devolve um dia por cada dia da janela, mesmo sem dados nenhuns', () => {
    // A faixa tem de ter sempre a mesma largura: um site novo com duas
    // observações não pode aparecer com duas barras gordas.
    const dias = dailyUptime([], INICIO, FIM)
    expect(dias).toHaveLength(3)
    expect(dias.every((d) => d.percent === null)).toBe(true)
  })

  it('ignora observações fora da janela', () => {
    const dias = dailyUptime([amostra('2026-08-15T10:00:00Z', false)], INICIO, FIM)
    expect(dias.every((d) => d.total === 0)).toBe(true)
  })
})
