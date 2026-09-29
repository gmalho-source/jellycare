import { describe, expect, it } from 'vitest'
import { buildReport, type ReportInput } from './build.js'
import { monthPeriod } from './period.js'
import { renderReportHtml } from './render.js'
import { REPORT_SECTIONS, includedSections, normaliseExcluded } from './sections.js'

const PERIOD = monthPeriod(2026, 6, 'Europe/Lisbon')
const INTERVAL = 5 * 60_000
const DIA = 24 * 3_600_000
const MEIO = new Date(PERIOD.start.getTime() + 10 * DIA)
const INICIO = new Date(PERIOD.start.getTime() + 2 * DIA)
const FIM = new Date(PERIOD.start.getTime() + 25 * DIA)
const ANTES = new Date(PERIOD.start.getTime() - 5 * DIA)

function relatorio(ajustes: Partial<ReportInput> = {}) {
  return buildReport({
    organizationName: 'Demo Cliente',
    site: { label: 'Site', url: 'https://demo.pt', hostname: 'demo.pt' },
    period: PERIOD,
    uptimeSamples: Array.from({ length: 50 }, (_, index) => ({
      observedAt: new Date(PERIOD.start.getTime() + index * INTERVAL),
      up: true,
    })),
    findings: [
      {
        checkType: 'tls',
        code: 'cert_expiring',
        severity: 'high',
        title: 'O certificado expira em 5 dias',
        state: 'open',
        firstSeenAt: MEIO,
        lastSeenAt: MEIO,
      },
    ],
    formRuns: [{ formLabel: 'Contacto', startedAt: MEIO, submitted: true, emailReceived: true }],
    checkRuns: [{ checkType: 'uptime', status: 'ok', startedAt: MEIO }],
    expectedIntervalMs: INTERVAL,
    ...ajustes,
  })
}

describe('módulos do relatório', () => {
  it('inclui tudo por omissão, menos o WordPress num site que não o tem', () => {
    // «Por omissão tudo» é o contrato. O WordPress é a exceção honesta: num
    // site sem ligação seria uma secção vazia a dizer que não há nada.
    const data = relatorio()
    expect(data.sections).toEqual(
      REPORT_SECTIONS.map((section) => section.key).filter((key) => key !== 'wordpress'),
    )
  })

  it('tira os módulos excluídos e ignora chaves que já não existem', () => {
    const data = relatorio({ excludedSections: ['desempenho', 'trabalho', 'modulo_que_morreu'] })
    expect(data.sections).not.toContain('desempenho')
    expect(data.sections).not.toContain('trabalho')
    expect(data.sections).toContain('disponibilidade')
  })

  it('o resumo não fala de módulos que foram tirados', () => {
    // Um resumo a falar da disponibilidade num relatório que não a mostra lê-se
    // como erro — o cliente vai à procura da secção e não a encontra.
    const comTudo = relatorio().summary.join(' ')
    expect(comTudo).toMatch(/disponível/)
    expect(comTudo).toMatch(/gravidade elevada/)
    expect(comTudo).toMatch(/formulários/)

    const semNada = relatorio({
      excludedSections: ['disponibilidade', 'seguranca', 'formularios'],
    }).summary.join(' ')
    expect(semNada).not.toMatch(/disponível/)
    expect(semNada).not.toMatch(/gravidade/)
    expect(semNada).not.toMatch(/formulários/)
    // E nunca fica vazio.
    expect(semNada.length).toBeGreaterThan(0)
  })

  it('os próximos passos não propõem ações sobre problemas que o relatório não mostra', () => {
    const comSeguranca = relatorio().recommendations.join(' ')
    const semSeguranca = relatorio({ excludedSections: ['seguranca'] }).recommendations.join(' ')
    expect(comSeguranca).not.toEqual(semSeguranca)
    expect(semSeguranca).toMatch(/Não há ações pendentes/)
  })

  it('o HTML só leva os módulos que entram', () => {
    const html = renderReportHtml(relatorio({ excludedSections: ['disponibilidade', 'proximos'] }))
    expect(html).not.toContain('<h2>Disponibilidade</h2>')
    expect(html).not.toContain('<h2>Próximos passos</h2>')
    expect(html).toContain('<h2>Segurança e qualidade</h2>')
  })

  it('normaliseExcluded fica só com chaves conhecidas, sem repetidos, pela ordem da lista', () => {
    expect(normaliseExcluded(['trabalho', 'x', 'disponibilidade', 'trabalho'])).toEqual([
      'disponibilidade',
      'trabalho',
    ])
    expect(includedSections([]).size).toBe(REPORT_SECTIONS.length)
  })
})

describe('desempenho', () => {
  it('mostra a pontuação do fim do mês e quanto mudou desde o início', () => {
    const data = relatorio({
      pageSpeedRuns: [
        { strategy: 'mobile', startedAt: INICIO, performanceScore: 48, lcpMs: 6100, cls: 0.2, tbtMs: 500 },
        { strategy: 'mobile', startedAt: FIM, performanceScore: 63, lcpMs: 3200, cls: 0.06, tbtMs: 150 },
        { strategy: 'desktop', startedAt: FIM, performanceScore: 91, lcpMs: 1200, cls: 0.01, tbtMs: 20 },
        // Fora do período: não conta.
        { strategy: 'mobile', startedAt: ANTES, performanceScore: 10, lcpMs: 9000, cls: 0.5, tbtMs: 900 },
      ],
    })
    expect(data.performance.mobile).toMatchObject({ latestScore: 63, firstScore: 48, runs: 2 })
    expect(data.performance.desktop).toMatchObject({ latestScore: 91, runs: 1 })

    const html = renderReportHtml(data)
    expect(html).toContain('<h2>Desempenho</h2>')
    expect(html).toContain('+15 no mês')
    expect(html).toContain('3,2 s')
  })

  it('diz que não houve medições em vez de desenhar uma tabela vazia', () => {
    const html = renderReportHtml(relatorio())
    expect(html).toContain('Não houve medições de velocidade neste período.')
  })
})

describe('WordPress', () => {
  const wordpress = {
    components: [
      { kind: 'core', name: 'WordPress', version: '6.4.3', latestVersion: '6.7.1' },
      { kind: 'plugin', name: 'contact-form-7', version: '5.7.0', latestVersion: '5.9.0' },
      { kind: 'plugin', name: 'em-dia', version: '2.0.0', latestVersion: null },
    ],
    updates: [
      { name: 'yoast', fromVersion: '21.0', toVersion: '22.1', status: 'succeeded', orderedAt: MEIO },
      { name: 'woo', fromVersion: '8.0', toVersion: '8.2', status: 'failed', orderedAt: MEIO },
      { name: 'antigo', fromVersion: '1', toVersion: '2', status: 'succeeded', orderedAt: ANTES },
    ],
    backups: [
      { startedAt: INICIO, finishedAt: INICIO, status: 'FINISHED' },
      { startedAt: FIM, finishedAt: FIM, status: 'FINISHED' },
      { startedAt: MEIO, finishedAt: null, status: 'ERROR' },
    ],
  }

  it('conta o que foi feito no mês e o que fica por fazer', () => {
    const data = relatorio({ wordpress })
    expect(data.sections).toContain('wordpress')
    expect(data.wordpress).toMatchObject({
      updatesFailed: 1,
      pendingUpdates: 1,
      coreOutdated: { version: '6.4.3', latestVersion: '6.7.1' },
      backups: 2,
      backupsFailed: 1,
    })
    expect(data.wordpress!.updatesApplied.map((update) => update.name)).toEqual(['yoast'])

    const html = renderReportHtml(data)
    expect(html).toContain('<h2>WordPress</h2>')
    expect(html).toContain('yoast')
    expect(html).not.toContain('antigo')
  })

  it('assinala um mês sem cópias de segurança', () => {
    const html = renderReportHtml(relatorio({ wordpress: { ...wordpress, backups: [] } }))
    expect(html).toContain('Não houve nenhuma cópia de segurança concluída durante o mês.')
  })

  it('sai quando é tirado, mesmo havendo ligação', () => {
    const data = relatorio({ wordpress, excludedSections: ['wordpress'] })
    expect(data.sections).not.toContain('wordpress')
    expect(renderReportHtml(data)).not.toContain('<h2>WordPress</h2>')
  })
})

describe('notas da equipa', () => {
  it('vêm logo a seguir ao resumo, escapadas e com as quebras de linha', () => {
    const html = renderReportHtml(
      relatorio({
        notes: ['Renovámos o alojamento.\nO site ficou mais rápido.', '  ', 'Veja <isto> & aquilo'],
      }),
    )
    expect(html).toContain('<h2>Notas da equipa</h2>')
    expect(html).toContain('Renovámos o alojamento.<br>O site ficou mais rápido.')
    expect(html).toContain('Veja &lt;isto&gt; &amp; aquilo')
    // A nota em branco não conta.
    expect(html.match(/<section class="block team-notes">[\s\S]*?<\/section>/)![0].match(/<p>/g)).toHaveLength(2)
    // Antes de qualquer módulo.
    expect(html.indexOf('Notas da equipa')).toBeLessThan(html.indexOf('<h2>Disponibilidade</h2>'))
  })

  it('não aparece quando não há notas', () => {
    expect(renderReportHtml(relatorio())).not.toContain('team-notes"')
  })
})
