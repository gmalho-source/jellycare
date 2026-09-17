import type { Severity } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import {
  buildReport,
  type ReportCheckRun,
  type ReportFinding,
  type ReportFormRun,
  type ReportInput,
} from './build.js'
import { monthPeriod } from './period.js'
import type { UptimeSample } from './uptime.js'

const PERIOD = monthPeriod(2026, 6, 'Europe/Lisbon')
const INTERVAL = 5 * 60_000
const ANTES = new Date(PERIOD.start.getTime() - 10 * 24 * 3_600_000)
const MEIO = new Date(PERIOD.start.getTime() + 10 * 24 * 3_600_000)
const DEPOIS = new Date(PERIOD.end.getTime() + 24 * 3_600_000)

function finding(overrides: Partial<ReportFinding> = {}): ReportFinding {
  return {
    checkType: 'security_headers',
    code: 'missing_frame_protection',
    severity: 'medium' as Severity,
    title: 'O site pode ser embebido num iframe por terceiros',
    state: 'open',
    firstSeenAt: MEIO,
    lastSeenAt: MEIO,
    ...overrides,
  }
}

function formRun(overrides: Partial<ReportFormRun> = {}): ReportFormRun {
  return {
    formLabel: 'Enviar · /contactos',
    startedAt: MEIO,
    submitted: true,
    emailReceived: true,
    deliveryLatencyMs: 10_000,
    ...overrides,
  }
}

function report(overrides: Partial<ReportInput> = {}) {
  return buildReport({
    organizationName: 'Demo Cliente',
    site: { label: 'Site', url: 'https://demo.pt', hostname: 'demo.pt' },
    period: PERIOD,
    uptimeSamples: [],
    findings: [],
    formRuns: [],
    checkRuns: [],
    expectedIntervalMs: INTERVAL,
    ...overrides,
  })
}

function samples(pattern: readonly boolean[], from = PERIOD.start): UptimeSample[] {
  return pattern.map((up, index) => ({
    observedAt: new Date(from.getTime() + index * INTERVAL),
    up,
    responseTimeMs: up ? 200 : null,
  }))
}

describe('buildReport — findings', () => {
  it('conta os abertos durante o período', () => {
    const data = report({
      findings: [finding({ firstSeenAt: MEIO }), finding({ firstSeenAt: ANTES })],
    })

    expect(data.findings.opened).toBe(1)
    expect(data.findings.stillOpen).toBe(2)
  })

  it('conta os resolvidos durante o período', () => {
    const data = report({
      findings: [
        finding({ firstSeenAt: ANTES, resolvedAt: MEIO, state: 'resolved' }),
        finding({ firstSeenAt: ANTES, resolvedAt: DEPOIS, state: 'resolved' }),
      ],
    })

    expect(data.findings.resolved).toBe(1)
    // O que só foi resolvido depois do período ainda estava aberto no fim dele.
    expect(data.findings.stillOpen).toBe(1)
  })

  it('não conta um problema que só apareceu depois do período', () => {
    const data = report({ findings: [finding({ firstSeenAt: DEPOIS })] })

    expect(data.findings.opened).toBe(0)
    expect(data.findings.stillOpen).toBe(0)
  })

  it('não conta como aberto um problema silenciado', () => {
    const data = report({ findings: [finding({ state: 'ignored' })] })
    expect(data.findings.stillOpen).toBe(0)
  })

  it('ordena os destaques pelos mais graves e mais antigos', () => {
    const data = report({
      findings: [
        finding({ severity: 'low', title: 'Baixo' }),
        finding({ severity: 'critical', title: 'Crítico recente', firstSeenAt: MEIO }),
        finding({ severity: 'critical', title: 'Crítico antigo', firstSeenAt: ANTES }),
      ],
    })

    expect(data.findings.highlights.map((f) => f.title)).toEqual([
      'Crítico antigo',
      'Crítico recente',
      'Baixo',
    ])
  })

  it('agrupa os abertos por severidade', () => {
    const data = report({
      findings: [
        finding({ severity: 'critical' }),
        finding({ severity: 'high' }),
        finding({ severity: 'high' }),
      ],
    })

    expect(data.findings.openBySeverity).toMatchObject({ critical: 1, high: 2, medium: 0 })
  })
})

describe('buildReport — formulários', () => {
  it('conta submissões, falhas e entregas do período', () => {
    const data = report({
      formRuns: [
        formRun(),
        formRun({ submitted: false, emailReceived: false }),
        formRun({ emailReceived: false }),
        formRun({ startedAt: ANTES }),
      ],
    })

    expect(data.forms).toMatchObject({
      submissions: 3,
      submissionFailures: 1,
      delivered: 1,
      notDelivered: 1,
    })
  })

  it('não conta como não entregue o que nem chegou a ser submetido', () => {
    // Contar as duas coisas distorceria o relatório: é um problema, não dois.
    const data = report({ formRuns: [formRun({ submitted: false, emailReceived: false })] })

    expect(data.forms.submissionFailures).toBe(1)
    expect(data.forms.notDelivered).toBe(0)
  })

  it('calcula a latência média das entregas', () => {
    const data = report({
      formRuns: [
        formRun({ deliveryLatencyMs: 10_000 }),
        formRun({ deliveryLatencyMs: 30_000 }),
        formRun({ emailReceived: false, deliveryLatencyMs: null }),
      ],
    })

    expect(data.forms.averageLatencyMs).toBe(20_000)
  })

  it('conta as que caíram no spam', () => {
    const data = report({ formRuns: [formRun({ landedInSpam: true }), formRun()] })
    expect(data.forms.landedInSpam).toBe(1)
  })
})

describe('buildReport — atividade', () => {
  it('conta execuções e falhas por tipo', () => {
    const runs: ReportCheckRun[] = [
      { checkType: 'uptime', status: 'ok', startedAt: MEIO },
      { checkType: 'uptime', status: 'ok', startedAt: MEIO },
      { checkType: 'reputation', status: 'failed', startedAt: MEIO },
      { checkType: 'uptime', status: 'ok', startedAt: ANTES },
    ]

    const data = report({ checkRuns: runs })

    expect(data.activity.checksRun).toBe(3)
    expect(data.activity.checksFailed).toBe(1)
    expect(data.activity.byType[0]).toMatchObject({ checkType: 'uptime', runs: 2 })
  })
})

describe('buildReport — resumo executivo', () => {
  it('celebra um mês sem interrupções', () => {
    const total = Math.round((PERIOD.end.getTime() - PERIOD.start.getTime()) / INTERVAL)
    const data = report({ uptimeSamples: samples(Array.from({ length: total }, () => true)) })

    expect(data.summary[0]).toContain('sempre disponível')
    expect(data.uptime.slaMet).toBe(true)
  })

  it('diz quanto tempo o site esteve em baixo', () => {
    const total = Math.round((PERIOD.end.getTime() - PERIOD.start.getTime()) / INTERVAL)
    const pattern = Array.from({ length: total }, (_, index) => index < 100 || index > 111)
    const data = report({ uptimeSamples: samples(pattern), slaTarget: 99.9 })

    expect(data.summary[0]).toContain('interrup')
    expect(data.summary[1]).toContain('não foi cumprido')
  })

  it('admite quando não observou o período todo em vez de inventar firmeza', () => {
    const data = report({ uptimeSamples: samples([true, true, true]) })

    expect(data.summary[0]).toContain('indicativo')
    expect(data.uptime.slaMet).toBeNull()
  })

  it('diz claramente que não houve observações', () => {
    expect(report().summary[0]).toContain('Não houve observações')
  })

  it('traduz formulários falhados em pedidos perdidos', () => {
    const data = report({
      formRuns: [formRun({ emailReceived: false }), formRun()],
    })

    const linha = data.summary.find((line) => line.includes('formulários'))
    expect(linha).toContain('se teriam perdido')
  })

  it('concorda em número no singular e no plural', () => {
    // O relatório vai para um cliente que paga; "Ficam 1 problema" não passa.
    const um = report({ findings: [finding({ severity: 'high' })] })
    expect(um.summary.some((line) => line.includes('Fica 1 problema'))).toBe(true)

    const varios = report({
      findings: [finding({ severity: 'high' }), finding({ severity: 'critical' })],
    })
    expect(varios.summary.some((line) => line.includes('Ficam 2 problemas'))).toBe(true)

    const umTeste = report({ formRuns: [formRun({ emailReceived: false })] })
    expect(umTeste.summary.some((line) => line.includes('1 não resultou'))).toBe(true)
  })

  it('reconhece o trabalho feito quando há problemas resolvidos', () => {
    const data = report({
      findings: [finding({ firstSeenAt: ANTES, resolvedAt: MEIO, state: 'resolved' })],
    })

    expect(data.summary.some((line) => line.includes('Foi corrigido 1 problema'))).toBe(true)
  })
})

describe('buildReport — recomendações', () => {
  it('propõe os problemas mais graves como ações', () => {
    const data = report({
      findings: [
        finding({ severity: 'critical', title: 'Certificado expirado' }),
        finding({ severity: 'low', title: 'Detalhe menor' }),
      ],
    })

    expect(data.recommendations[0]).toBe('Certificado expirado')
    // Os de severidade baixa ficam no corpo do relatório, não nas ações.
    expect(data.recommendations).not.toContain('Detalhe menor')
  })

  it('limita a lista a cinco ações', () => {
    const data = report({
      findings: Array.from({ length: 10 }, (_, index) =>
        finding({ severity: 'high', title: `Problema ${index}` }),
      ),
    })

    expect(data.recommendations).toHaveLength(5)
  })

  it('acrescenta a autenticação de email quando há entregas no spam', () => {
    const data = report({ formRuns: [formRun({ landedInSpam: true })] })
    expect(data.recommendations.some((line) => line.includes('SPF'))).toBe(true)
  })

  it('diz que não há nada pendente quando é o caso', () => {
    expect(report().recommendations[0]).toContain('Não há ações pendentes')
  })
})

describe('buildReport — identidade', () => {
  it('usa a marca Jellycare por omissão', () => {
    expect(report().brand.name).toBe('Jellycare')
  })

  it('aceita marca própria, para relatórios white-label', () => {
    const data = report({ brand: { name: 'Estúdio X', url: 'https://estudiox.pt' } })
    expect(data.brand.name).toBe('Estúdio X')
  })
})
