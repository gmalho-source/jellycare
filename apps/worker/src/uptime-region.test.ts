import type { CheckOutcome, ObservedFinding } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import {
  applyRegionCorroboration,
  toUptimeSample,
  type RegionSample,
} from './uptime-region.js'

const NOW = new Date('2026-09-17T10:00:00Z')

const DOWN: ObservedFinding = {
  code: 'site_down',
  severity: 'critical',
  title: 'Site inacessível: Ligação recusada pelo servidor',
  evidence: { reason: 'connection_refused', url: 'https://cliente.pt' },
}

const SLOW: ObservedFinding = {
  code: 'slow_response',
  severity: 'low',
  title: 'Resposta lenta',
}

function sample(overrides: Partial<RegionSample> = {}): RegionSample {
  return {
    region: 'eu-central',
    up: true,
    observedAt: new Date('2026-09-17T09:58:00Z'),
    ...overrides,
  }
}

function corroborate(
  findings: ObservedFinding[],
  samples: RegionSample[],
  windowMs?: number,
) {
  return applyRegionCorroboration(findings, samples, {
    region: 'eu-west',
    now: NOW,
    ...(windowMs !== undefined ? { windowMs } : {}),
  })
}

describe('applyRegionCorroboration', () => {
  it('não mexe num run sem indisponibilidade', () => {
    const result = corroborate([SLOW], [sample()])

    expect(result.verdict).toBe('not_applicable')
    expect(result.findings).toEqual([SLOW])
  })

  it('mantém o alerta crítico quando não há segunda opinião', () => {
    // Quem corre uma região só continua a ser avisado — é melhor do que nada.
    const result = corroborate([DOWN], [])

    expect(result.verdict).toBe('no_data')
    expect(result.findings[0]?.code).toBe('site_down')
    expect(result.findings[0]?.severity).toBe('critical')
  })

  it('mantém o alerta crítico quando outra região confirma a queda', () => {
    const result = corroborate([DOWN], [sample({ up: false })])

    expect(result.verdict).toBe('corroborated')
    expect(result.findings[0]?.code).toBe('site_down')
  })

  it('ignora amostras antigas de outras regiões', () => {
    const antiga = sample({ observedAt: new Date('2026-09-17T09:00:00Z') })
    const result = corroborate([DOWN], [antiga])

    // Uma amostra de há uma hora não diz nada sobre o estado atual.
    expect(result.verdict).toBe('no_data')
  })

  it('ignora amostras da própria região', () => {
    const result = corroborate([DOWN], [sample({ region: 'eu-west', up: true })])
    expect(result.verdict).toBe('no_data')
  })

  it('substitui o crítico quando outra região alcança o site', () => {
    const result = corroborate([DOWN], [sample({ region: 'eu-central', up: true })])

    expect(result.verdict).toBe('contradicted')
    expect(result.findings).toHaveLength(1)

    const finding = result.findings[0]
    expect(finding?.code).toBe('site_unreachable_from_region')
    expect(finding?.severity).toBe('medium')
    // O problema não é calado: uma geo-restrição ou uma borda de CDN em baixo
    // continua a ser informação que o cliente quer ter.
    expect(finding?.discriminator).toBe('eu-west')
    expect(finding?.detail).toContain('eu-central')
    expect(finding?.evidence).toMatchObject({ reachableFrom: ['eu-central'] })
  })

  it('preserva os restantes findings ao substituir', () => {
    const result = corroborate([DOWN, SLOW], [sample({ up: true })])

    expect(result.findings.map((f) => f.code)).toEqual([
      'site_unreachable_from_region',
      'slow_response',
    ])
  })

  it('basta uma região a alcançar o site para contradizer', () => {
    const result = corroborate(
      [DOWN],
      [
        sample({ region: 'eu-central', up: false }),
        sample({ region: 'us-east', up: true }),
      ],
    )

    expect(result.verdict).toBe('contradicted')
    expect(result.reachableFrom).toEqual(['us-east'])
  })

  it('enumera várias regiões alcançáveis em português legível', () => {
    const result = corroborate(
      [DOWN],
      [
        sample({ region: 'eu-central', up: true }),
        sample({ region: 'us-east', up: true }),
      ],
    )

    expect(result.findings[0]?.detail).toContain('as de eu-central e us-east')
  })

  it('não duplica a mesma região alcançável', () => {
    const result = corroborate(
      [DOWN],
      [
        sample({ region: 'eu-central', up: true }),
        sample({ region: 'eu-central', up: true, observedAt: new Date('2026-09-17T09:59:00Z') }),
      ],
    )

    expect(result.reachableFrom).toEqual(['eu-central'])
  })
})

describe('toUptimeSample', () => {
  function outcome(overrides: Partial<CheckOutcome> = {}): CheckOutcome {
    return {
      status: 'ok',
      findings: [],
      metrics: { up: 1, statusCode: 200, responseTimeMs: 180 },
      durationMs: 200,
      ...overrides,
    }
  }

  it('regista uma observação saudável', () => {
    const sampleRow = toUptimeSample(outcome(), { region: 'eu-west', observedAt: NOW })

    expect(sampleRow).toMatchObject({
      region: 'eu-west',
      up: true,
      statusCode: 200,
      responseTimeMs: 180,
      failureReason: null,
    })
  })

  it('regista a causa da indisponibilidade', () => {
    const sampleRow = toUptimeSample(
      outcome({ findings: [DOWN], metrics: { up: 0 } }),
      { region: 'eu-west', observedAt: NOW },
    )

    expect(sampleRow.up).toBe(false)
    expect(sampleRow.failureReason).toBe('connection_refused')
    expect(sampleRow.statusCode).toBeNull()
  })

  it('não conta um check rebentado como site em cima', () => {
    // Contar isto como disponível inflacionaria o SLA que reportamos ao cliente.
    const sampleRow = toUptimeSample(
      { status: 'failed', findings: [], metrics: {}, error: 'ETIMEDOUT', durationMs: 30_000 },
      { region: 'eu-west', observedAt: NOW },
    )

    expect(sampleRow.up).toBe(false)
    expect(sampleRow.failureReason).toBe('ETIMEDOUT')
  })

  it('trata conteúdo em falta como indisponibilidade para efeitos de SLA', () => {
    const contentMissing: ObservedFinding = {
      code: 'content_missing',
      severity: 'critical',
      title: 'Conteúdo esperado desapareceu',
    }
    const sampleRow = toUptimeSample(
      outcome({ findings: [contentMissing], metrics: { up: 0, statusCode: 200 } }),
      { region: 'eu-west', observedAt: NOW },
    )

    expect(sampleRow.up).toBe(false)
    expect(sampleRow.failureReason).toBe('content_missing')
  })
})
