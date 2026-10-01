import { describe, expect, it } from 'vitest'
import { classeDe, curva, escala, fracaoDoMostrador, resumir, trocos, type DiaResposta } from './tempo-resposta'

const dia = (day: string, average: number | null): DiaResposta => ({
  day,
  average,
  slowest: average,
  samples: average === null ? 0 : 288,
})

describe('resumir', () => {
  it('média, dia mais rápido e mais lento, sem contar os dias vazios como zero', () => {
    const resumo = resumir([dia('2026-09-22', 360), dia('2026-09-23', null), dia('2026-09-24', 196), dia('2026-09-25', 679)])
    expect(resumo).toEqual({
      media: 412,
      maisRapido: { indice: 2, ms: 196 },
      maisLento: { indice: 3, ms: 679 },
      diasComDados: 3,
    })
  })

  it('sem nenhum dia com observações não inventa números', () => {
    expect(resumir([dia('2026-09-22', null)])).toBeNull()
  })
})

describe('classeDe', () => {
  it('usa os limiares de 800 ms e 1,8 s', () => {
    expect([799, 800, 1800, 1801].map(classeDe)).toEqual(['bom', 'medio', 'medio', 'mau'])
  })
})

describe('escala', () => {
  it('começa no zero, em números redondos, com folga acima do dia mais lento', () => {
    expect(escala(679)).toEqual({ teto: 800, marcas: [0, 200, 400, 600, 800] })
    expect(escala(1900)).toEqual({ teto: 2400, marcas: [0, 600, 1200, 1800, 2400] })
    expect(escala(90).teto).toBe(200)
  })
})

describe('curva', () => {
  it('passa por todos os pontos medidos', () => {
    const pontos = [
      { x: 0, y: 100 },
      { x: 10, y: 20 },
      { x: 20, y: 80 },
    ]
    const d = curva(pontos)
    expect(d.startsWith('M0,100')).toBe(true)
    expect(d).toContain(' 10,20')
    expect(d.endsWith(' 20,80')).toBe(true)
  })

  it('nunca desenha um pico além do valor medido', () => {
    // Num pico, a tangente é horizontal: os pontos de controlo ficam à altura
    // do próprio pico e não acima dele.
    const d = curva([
      { x: 0, y: 100 },
      { x: 10, y: 20 },
      { x: 20, y: 100 },
    ])
    const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]))
    expect(Math.min(...ys)).toBe(20)
    expect(Math.max(...ys)).toBe(100)
  })
})

describe('fracaoDoMostrador', () => {
  it('é linear até ao máximo e não sai do mostrador', () => {
    expect(fracaoDoMostrador(0)).toBe(0)
    expect(fracaoDoMostrador(1350)).toBe(0.5)
    expect(fracaoDoMostrador(9000)).toBe(1)
  })
})

describe('trocos', () => {
  it('parte a linha nos dias sem observações', () => {
    const resultado = trocos([dia('a', 100), dia('b', 200), dia('c', null), dia('d', 300)])
    expect(resultado).toEqual([
      [
        { indice: 0, ms: 100 },
        { indice: 1, ms: 200 },
      ],
      [{ indice: 3, ms: 300 }],
    ])
  })
})
