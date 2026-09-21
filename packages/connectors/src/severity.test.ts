import { describe, expect, it } from 'vitest'
import { severityFromCvss } from './severity.js'

describe('severityFromCvss', () => {
  it('usa as faixas oficiais do CVSS v3', () => {
    // As fronteiras são o que interessa testar: é onde um engano de um
    // décimo faz um crítico parecer elevado.
    expect(severityFromCvss(10)).toBe('critical')
    expect(severityFromCvss(9)).toBe('critical')
    expect(severityFromCvss(8.9)).toBe('high')
    expect(severityFromCvss(7)).toBe('high')
    expect(severityFromCvss(6.9)).toBe('medium')
    expect(severityFromCvss(4)).toBe('medium')
    expect(severityFromCvss(3.9)).toBe('low')
    expect(severityFromCvss(0.1)).toBe('low')
    expect(severityFromCvss(0)).toBe('info')
  })

  it('trata uma vulnerabilidade sem score como média, não como nada', () => {
    // Não saber quantificar não é o mesmo que não haver problema.
    expect(severityFromCvss(null)).toBe('medium')
    expect(severityFromCvss(Number.NaN)).toBe('medium')
  })
})
