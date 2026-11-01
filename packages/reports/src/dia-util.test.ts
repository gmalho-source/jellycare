import { describe, expect, it } from 'vitest'
import { domingoDePascoa, feriadosNacionais, horaDoRelatorio, primeiroDiaUtil } from './dia-util.js'

const LISBOA = 'Europe/Lisbon'

describe('domingoDePascoa', () => {
  it('acerta nos anos conhecidos', () => {
    expect(domingoDePascoa(2025)).toEqual({ mes: 4, dia: 20 })
    expect(domingoDePascoa(2026)).toEqual({ mes: 4, dia: 5 })
    expect(domingoDePascoa(2027)).toEqual({ mes: 3, dia: 28 })
    expect(domingoDePascoa(2029)).toEqual({ mes: 4, dia: 1 })
  })
})

describe('feriadosNacionais', () => {
  it('inclui os móveis: Sexta-feira Santa e Corpo de Deus', () => {
    const feriados = feriadosNacionais(2026)
    expect(feriados.has('4-3')).toBe(true) // Sexta-feira Santa
    expect(feriados.has('6-4')).toBe(true) // Corpo de Deus
    expect(feriados.has('2-17')).toBe(false) // Carnaval não é obrigatório
  })
})

describe('primeiroDiaUtil', () => {
  it('salta fins de semana e feriados', () => {
    expect(primeiroDiaUtil(2026, 11)).toBe(2) // 1 é domingo e Todos os Santos
    expect(primeiroDiaUtil(2026, 12)).toBe(2) // 1 de dezembro é feriado
    expect(primeiroDiaUtil(2027, 1)).toBe(4) // 1 feriado, 2 e 3 fim de semana
    expect(primeiroDiaUtil(2026, 8)).toBe(3) // 1 de agosto é sábado
    expect(primeiroDiaUtil(2026, 10)).toBe(1) // quinta-feira
    expect(primeiroDiaUtil(2026, 5)).toBe(4) // 1 de maio é feriado, 2 e 3 fim de semana
    expect(primeiroDiaUtil(2029, 4)).toBe(2) // 1 de abril é domingo de Páscoa, segunda é útil
    expect(primeiroDiaUtil(2021, 4)).toBe(1) // 2 de abril de 2021 foi Sexta-feira Santa, mas o 1 é útil
  })

  it('apanha a Sexta-feira Santa no primeiro dia do mês', () => {
    // Em 1994 a Páscoa foi a 3 de abril: a Sexta-feira Santa caiu a 1.
    expect(feriadosNacionais(1994).has('4-1')).toBe(true)
    expect(primeiroDiaUtil(1994, 4)).toBe(4) // 1 feriado, 2 e 3 fim de semana
  })
})

describe('horaDoRelatorio', () => {
  it('só a partir das nove do primeiro dia útil, em Lisboa', () => {
    // Novembro de 2026: primeiro dia útil é segunda, 2.
    expect(horaDoRelatorio(new Date('2026-11-01T10:00:00Z'), LISBOA)).toBe(false)
    expect(horaDoRelatorio(new Date('2026-11-02T08:30:00Z'), LISBOA)).toBe(false) // 08:30 em Lisboa
    expect(horaDoRelatorio(new Date('2026-11-02T09:00:00Z'), LISBOA)).toBe(true)
    expect(horaDoRelatorio(new Date('2026-11-20T03:00:00Z'), LISBOA)).toBe(true) // atrasado, envia
  })

  it('conta a hora no fuso do cliente, com hora de verão', () => {
    // Outubro de 2026: dia 1 é quinta, útil. Em Lisboa, 09:00 de verão são 08:00 UTC.
    expect(horaDoRelatorio(new Date('2026-10-01T07:59:00Z'), LISBOA)).toBe(false)
    expect(horaDoRelatorio(new Date('2026-10-01T08:00:00Z'), LISBOA)).toBe(true)
  })
})
