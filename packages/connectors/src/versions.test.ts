import { describe, expect, it } from 'vitest'
import { compareVersions, isOutdated } from './versions.js'

describe('compareVersions', () => {
  it('trata uma componente em falta como zero', () => {
    expect(compareVersions('6.5', '6.5.0')).toBe(0)
    expect(compareVersions('6.5.0', '6.5')).toBe(0)
  })

  it('compara número a número e não texto a texto', () => {
    // O caso que uma comparação alfabética erra: '10' < '9' como texto.
    expect(compareVersions('6.10', '6.9')).toBeGreaterThan(0)
    expect(compareVersions('6.9', '6.10')).toBeLessThan(0)
  })

  it('ordena versões menores dentro da mesma minor', () => {
    expect(compareVersions('6.5.1', '6.5.2')).toBeLessThan(0)
    expect(compareVersions('6.5.2', '6.5.1')).toBeGreaterThan(0)
  })

  it('ignora o sufixo de pré-lançamento', () => {
    expect(compareVersions('6.6-RC1', '6.6')).toBe(0)
  })
})

describe('isOutdated', () => {
  it('diz que sim quando a instalada é anterior', () => {
    expect(isOutdated('6.4.0', '6.5.0')).toBe(true)
  })

  it('não confunde 6.5 com 6.5.0', () => {
    expect(isOutdated('6.5', '6.5.0')).toBe(false)
  })

  it('não chama desatualizado a quem vai à frente', () => {
    // Uma RC ou um nightly. Dizer-lhe que está atrasado mina a confiança em
    // tudo o resto que o painel afirma.
    expect(isOutdated('6.7', '6.6')).toBe(false)
  })

  it('não afirma nada sem saber as duas versões', () => {
    // Não saber em que versão o site está é diferente de saber que está
    // atrasado.
    expect(isOutdated(null, '6.5')).toBe(false)
    expect(isOutdated('6.5', null)).toBe(false)
    expect(isOutdated(null, null)).toBe(false)
  })
})
