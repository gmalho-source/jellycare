import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildReport, type ReportInput } from './build.js'
import { monthPeriod } from './period.js'
import { renderReportPdf, reportFileName } from './pdf.js'
import { escapeHtml, renderReportHtml } from './render.js'

const PERIOD = monthPeriod(2026, 6, 'Europe/Lisbon')
const INTERVAL = 5 * 60_000
const MEIO = new Date(PERIOD.start.getTime() + 10 * 24 * 3_600_000)

function report(overrides: Partial<ReportInput> = {}) {
  return buildReport({
    organizationName: 'Demo Cliente',
    site: { label: 'Site institucional', url: 'https://demo.pt', hostname: 'demo.pt' },
    period: PERIOD,
    uptimeSamples: [],
    findings: [],
    formRuns: [],
    checkRuns: [],
    expectedIntervalMs: INTERVAL,
    ...overrides,
  })
}

const COMPLETO = () => {
  const total = Math.round((PERIOD.end.getTime() - PERIOD.start.getTime()) / INTERVAL)
  return report({
    uptimeSamples: Array.from({ length: total }, (_, index) => ({
      observedAt: new Date(PERIOD.start.getTime() + index * INTERVAL),
      up: index < 200 || index > 240,
      responseTimeMs: 210,
      failureReason: index >= 200 && index <= 240 ? 'HTTP 503' : null,
    })),
    findings: [
      {
        checkType: 'form_delivery',
        code: 'form_email_not_delivered',
        discriminator: 'form-1',
        severity: 'high',
        title: 'O formulário de contacto não gerou notificação por email',
        detail: 'A submissão foi aceite mas não chegou mensagem nenhuma.',
        state: 'open',
        firstSeenAt: MEIO,
        lastSeenAt: MEIO,
      },
      {
        checkType: 'tls',
        code: 'cert_expiring',
        severity: 'medium',
        title: 'O certificado expira em 12 dias',
        state: 'resolved',
        firstSeenAt: new Date(PERIOD.start.getTime() + 3 * 24 * 3_600_000),
        lastSeenAt: MEIO,
        resolvedAt: MEIO,
      },
    ],
    formRuns: [
      { formLabel: 'Contacto', startedAt: MEIO, submitted: true, emailReceived: true, deliveryLatencyMs: 9_000 },
      { formLabel: 'Contacto', startedAt: MEIO, submitted: true, emailReceived: false },
    ],
    checkRuns: [
      { checkType: 'uptime', status: 'ok', startedAt: MEIO },
      { checkType: 'broken_links', status: 'ok', startedAt: MEIO },
    ],
    slaTarget: 99.9,
  })
}

describe('escapeHtml', () => {
  it('neutraliza marcação vinda dos dados', () => {
    // Títulos e detalhes de findings contêm URLs e texto do site do cliente.
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(escapeHtml('a & b "c" \'d\'')).toBe('a &amp; b &quot;c&quot; &#39;d&#39;')
  })
})

describe('renderReportHtml', () => {
  it('produz um documento completo com o período e o cliente', () => {
    const html = renderReportHtml(COMPLETO())

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('junho de 2026')
    expect(html).toContain('Demo Cliente')
    expect(html).toContain('Site institucional')
  })

  it('mostra a disponibilidade e as interrupções', () => {
    const html = renderReportHtml(COMPLETO())

    expect(html).toContain('Disponibilidade')
    expect(html).toContain('HTTP 503')
    expect(html).toContain('Abaixo do objetivo')
  })

  it('separa o que ficou em aberto do que foi corrigido', () => {
    const html = renderReportHtml(COMPLETO())

    expect(html).toContain('não gerou notificação por email')
    expect(html).toContain('Corrigido durante o mês')
  })

  it('traduz os tipos de verificação para linguagem do cliente', () => {
    const html = renderReportHtml(COMPLETO())

    expect(html).toContain('Links quebrados')
    expect(html).not.toContain('broken_links')
  })

  it('escapa dados do cliente no corpo do relatório', () => {
    const html = renderReportHtml(
      report({
        site: { label: '<img src=x onerror=alert(1)>', url: 'https://demo.pt', hostname: 'demo.pt' },
      }),
    )

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('diz com todas as letras quando não há dados', () => {
    const html = renderReportHtml(report())

    expect(html).toContain('Não há observações de disponibilidade')
    expect(html).toContain('Não foram testados formulários')
    expect(html).toContain('Não há ações pendentes')
  })

  it('assinala quando a cobertura foi parcial em vez de afirmar o SLA', () => {
    const html = renderReportHtml(
      report({
        uptimeSamples: [
          { observedAt: PERIOD.start, up: true, responseTimeMs: 100 },
          { observedAt: new Date(PERIOD.start.getTime() + INTERVAL), up: true, responseTimeMs: 100 },
        ],
      }),
    )

    expect(html).toContain('valor indicativo')
    expect(html).not.toContain('Objetivo de')
  })

  it('usa a marca configurada', () => {
    const html = renderReportHtml(
      report({ brand: { name: 'Estúdio X', url: 'https://estudiox.pt' } }),
    )

    expect(html).toContain('Estúdio X')
    expect(html).toContain('https://estudiox.pt')
  })
})

describe('reportFileName', () => {
  it('produz um nome previsível e ordenável', () => {
    expect(reportFileName(COMPLETO())).toBe('jellycare-demo-pt-2026-06.pdf')
  })

  it('limpa caracteres do domínio', () => {
    const data = report({
      site: { label: 'X', url: 'https://sub.cliente-x.pt', hostname: 'sub.cliente-x.pt' },
    })
    expect(reportFileName(data)).toBe('jellycare-sub-cliente-x-pt-2026-06.pdf')
  })
})

describe('renderReportPdf', () => {
  const preinstalled = '/opt/pw-browsers/chromium'
  const launch = {
    ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
    noSandbox: true,
  }

  it('gera um PDF válido a partir do relatório', async () => {
    const pdf = await renderReportPdf(COMPLETO(), { launch })

    // Assinatura do formato: sem isto, um buffer vazio passaria no teste.
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(5_000)
  }, 120_000)

  it('gera PDF também quando não há dados nenhuns', async () => {
    const pdf = await renderReportPdf(report(), { launch })

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  }, 120_000)
})
