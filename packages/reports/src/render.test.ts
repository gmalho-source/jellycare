import { explicacaoDe } from '@jellycare/core'
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
    expect(html).toContain('não cumprido')
  })

  it('separa o que ficou em aberto do que foi corrigido', () => {
    const html = renderReportHtml(COMPLETO())

    expect(html).toContain(explicacaoDe('form_email_not_delivered')!.titulo)
    expect(html).toContain('Corrigido durante o mês')
  })

  it('fala ao cliente na língua dele e diz o que a Jelly faz', () => {
    // O relatório é a versão em papel do que o cliente vê no portal. Antes
    // levava o título técnico tal como a equipa o lê, o que num PDF que vai
    // para o cliente é pior do que no painel: não há ninguém ao lado para
    // explicar.
    const html = renderReportHtml(COMPLETO())

    // Um problema em aberto leva a explicação inteira.
    const aberto = explicacaoDe('form_email_not_delivered')!
    expect(html).toContain(aberto.titulo)
    expect(html).toContain(aberto.oQueE)
    expect(html).toContain(aberto.oQueFazemos)
    expect(html).not.toContain('O formulário de contacto não gerou notificação por email')

    // Um já corrigido leva só o título: não há nada a explicar nem a fazer.
    expect(html).toContain(explicacaoDe('cert_expiring')!.titulo)
    expect(html).not.toContain('O certificado expira em 12 dias')
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

describe('renderReportHtml — janela e parcial', () => {
  it('diz desde quando o site é acompanhado, e que um relatório parcial é provisório', () => {
    const periodo = monthPeriod(2026, 9, 'Europe/Lisbon')
    const html = renderReportHtml(
      buildReport({
        organizationName: 'Jelly',
        site: { label: 'Jelly', url: 'https://jelly.pt', hostname: 'jelly.pt' },
        period: { ...periodo, end: new Date('2026-09-30T10:00:00Z'), partial: true, label: 'setembro de 2026 (até 30/09)' },
        monitoredFrom: new Date('2026-09-22T08:05:00Z'),
        uptimeSamples: [],
        findings: [],
        formRuns: [],
        checkRuns: [],
      }),
    )

    expect(html).toContain('acompanhamento desde 22 de setembro de 2026')
    expect(html).toContain('Relatório provisório')
  })
})

describe('renderReportHtml — primeira página, verificações e atividade', () => {
  const comSeguranca = () =>
    report({
      checkRuns: [
        { checkType: 'security_headers', status: 'ok', startedAt: MEIO },
        { checkType: 'email_auth', status: 'ok', startedAt: MEIO, metrics: { dkimSelectorsFound: 2 } },
      ],
      findings: [
        {
          checkType: 'security_headers',
          code: 'missing_frame_protection',
          severity: 'medium',
          title: 'x',
          state: 'open',
          firstSeenAt: MEIO,
          lastSeenAt: MEIO,
        },
      ],
      pageSpeedRuns: [
        { strategy: 'mobile', startedAt: MEIO, performanceScore: 68, lcpMs: 5500, cls: 0, tbtMs: 12, accessibilityScore: 95, bestPracticesScore: 100, seoScore: 100, agenticPassed: 3, agenticTotal: 3 },
      ],
    })

  it('abre com os semáforos de segurança e de desempenho', () => {
    const html = renderReportHtml(comSeguranca())
    expect(html).toContain('<h2>Estado geral</h2>')
    // Um problema médio de segurança: laranja, «A acompanhar». Desempenho 68: «A melhorar».
    expect(html).toContain('A acompanhar')
    expect(html).toContain('A melhorar')
    expect(html).toContain('<h2>Indicadores do mês</h2>')
  })

  it('lista o que foi verificado, com o que passou e o que não passou', () => {
    const html = renderReportHtml(comSeguranca())
    expect(html).toContain('<h2>Segurança — o que verificámos</h2>')
    expect(html).toContain('data-verificacao="https" data-estado="ok"')
    expect(html).toContain('data-verificacao="cabecalhos" data-estado="aviso"')
    expect(html).toContain('2 seletores')
  })

  it('mostra as cinco categorias do Lighthouse, a navegação com agência como fração', () => {
    const html = renderReportHtml(comSeguranca())
    expect(html).toContain('aria-label="Acessibilidade: 95 em 100"')
    expect(html).toContain('aria-label="SEO: 100 em 100"')
    expect(html).toContain('aria-label="Navegação com agência: 3 de 3"')
  })

  it('num site que entrou a meio, junta os dias anteriores num bloco em vez de barras vazias', () => {
    const html = renderReportHtml(
      report({ monitoredFrom: new Date(PERIOD.end.getTime() - 5 * 24 * 3_600_000), uptimeSamples: [
        { observedAt: new Date(PERIOD.end.getTime() - 3_600_000), up: true, responseTimeMs: 200 },
      ] }),
    )
    expect(html).toContain('antes do acompanhamento')
    expect(html).toContain('O site entra em acompanhamento.')
  })

  it('sem nenhuma verificação de segurança no período, o semáforo não fica verde', () => {
    const html = renderReportHtml(report())
    expect(html).toContain('Por verificar')
    expect(html).not.toContain('Sem ameaças')
  })

  it('tirar os módulos tira os semáforos e os indicadores correspondentes', () => {
    const semModulos = renderReportHtml(
      report({
        excludedSections: ['seguranca', 'desempenho'],
        pageSpeedRuns: [{ strategy: 'mobile', startedAt: MEIO, performanceScore: 68, lcpMs: null, cls: null, tbtMs: null }],
      }),
    )
    expect(semModulos).not.toContain('<h2>Estado geral</h2>')
    expect(semModulos).not.toContain('<span class="kpi-label">Desempenho</span>')
  })
})
