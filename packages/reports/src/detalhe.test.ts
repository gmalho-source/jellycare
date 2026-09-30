import { describe, expect, it } from 'vitest'
import { buildDiario, buildTimeline, buildVerificacoes } from './detalhe.js'
import { monthPeriod } from './period.js'

const SETEMBRO = monthPeriod(2026, 9, 'Europe/Lisbon')
const DIA_25 = new Date('2026-09-25T10:00:00Z')

const ok = (checkType: string, metrics?: Record<string, number>) => ({
  checkType,
  status: 'ok' as const,
  startedAt: DIA_25,
  ...(metrics ? { metrics } : {}),
})

describe('buildVerificacoes', () => {
  it('mostra o que passou, e não só o que falhou', () => {
    const itens = buildVerificacoes(
      [ok('security_headers'), ok('email_auth', { dkimSelectorsFound: 2 }), ok('exposed_files', { pathsProbed: 10 })],
      [],
      null,
    )

    expect(itens.map((i) => [i.chave, i.estado])).toEqual([
      ['https', 'ok'],
      ['email', 'ok'],
      ['dmarc', 'ok'],
      ['ficheiros', 'ok'],
      ['cabecalhos', 'ok'],
    ])
    expect(itens.find((i) => i.chave === 'email')?.detalhe).toContain('2 seletores')
    expect(itens.find((i) => i.chave === 'ficheiros')?.detalhe).toContain('10 caminhos')
  })

  it('não põe um visto no que não correu, nem no que só falhou', () => {
    // Afirmar que o certificado está válido sem o ter verificado é pior do
    // que não dizer nada.
    const itens = buildVerificacoes(
      [{ checkType: 'tls', status: 'failed', startedAt: DIA_25 }],
      [],
      null,
    )
    expect(itens).toEqual([])
  })

  it('julga pelos problemas em aberto e diz quais são', () => {
    const itens = buildVerificacoes(
      [ok('security_headers'), ok('email_auth')],
      [
        { checkType: 'security_headers', code: 'missing_frame_protection', severity: 'medium' },
        { checkType: 'security_headers', code: 'missing_csp', severity: 'low' },
        { checkType: 'email_auth', code: 'dmarc_policy_none', severity: 'low' },
      ],
      null,
    )

    const por = (chave: string) => itens.find((i) => i.chave === chave)
    expect(por('https')?.estado).toBe('ok')
    expect(por('cabecalhos')).toMatchObject({ estado: 'aviso', titulo: 'Cabeçalhos de segurança: 2 por corrigir' })
    expect(por('dmarc')?.estado).toBe('aviso')
    expect(por('email')?.estado).toBe('ok')
  })

  it('um problema elevado é falha, não aviso', () => {
    const itens = buildVerificacoes(
      [ok('tls', { certDaysRemaining: 3 })],
      [{ checkType: 'tls', code: 'cert_expired', severity: 'critical' }],
      null,
    )
    expect(itens[0]?.estado).toBe('falha')
  })

  it('diz até quando o certificado é válido, a partir da última verificação', () => {
    const itens = buildVerificacoes([ok('tls', { certDaysRemaining: 106 })], [], null)
    expect(itens[0]?.detalhe).toContain('Válido até 9 de janeiro de 2027')
  })
})

describe('buildDiario', () => {
  it('um registo por dia, com os dias antes da entrada marcados', () => {
    const entrada = new Date('2026-09-22T08:05:00Z')
    const amostras = [
      { observedAt: new Date('2026-09-22T09:00:00Z'), up: true, responseTimeMs: 200 },
      { observedAt: new Date('2026-09-22T10:00:00Z'), up: false },
      { observedAt: new Date('2026-09-23T10:00:00Z'), up: true, responseTimeMs: 400 },
    ]

    const dias = buildDiario(SETEMBRO, entrada, amostras)

    expect(dias).toHaveLength(30)
    expect(dias[20]).toMatchObject({ dia: '2026-09-21', antes: true, disponivel: null })
    expect(dias[21]).toMatchObject({ dia: '2026-09-22', antes: false, disponivel: 50, respostaMs: 200 })
    expect(dias[22]).toMatchObject({ rotulo: '23', disponivel: 100, respostaMs: 400 })
    // Um dia acompanhado sem observações fica sem valor, e não a zero.
    expect(dias[23]).toMatchObject({ antes: false, disponivel: null })
  })

  it('não salta nem repete dias na mudança da hora', () => {
    const outubro = monthPeriod(2026, 10, 'Europe/Lisbon')
    const dias = buildDiario(outubro, null, [])
    expect(dias.map((d) => d.rotulo)).toEqual(Array.from({ length: 31 }, (_, i) => String(i + 1)))
  })

  it('num relatório do mês em curso, para no dia de hoje', () => {
    const parcial = { ...SETEMBRO, end: new Date('2026-09-10T12:00:00Z'), partial: true }
    expect(buildDiario(parcial, null, [])).toHaveLength(10)
  })
})

describe('buildTimeline', () => {
  const base = {
    period: SETEMBRO,
    monitoredFrom: null,
    findings: [],
    incidents: [],
    updates: [],
    notices: [],
    mobile: [],
  }

  it('conta o mês por ordem: entrada, problemas, correções, avisos, velocidade', () => {
    const eventos = buildTimeline({
      ...base,
      monitoredFrom: new Date('2026-09-22T08:05:00Z'),
      findings: [
        { code: 'missing_csp', title: 'x', severity: 'low', firstSeenAt: new Date('2026-09-22T09:00:00Z') },
        { code: 'missing_frame_protection', title: 'y', severity: 'medium', firstSeenAt: new Date('2026-09-22T09:00:00Z'), resolvedAt: new Date('2026-09-28T09:00:00Z') },
      ],
      notices: [{ sentAt: new Date('2026-09-26T09:00:00Z'), subject: 'O vosso DMARC' }],
      mobile: [
        { startedAt: new Date('2026-09-22T10:00:00Z'), score: 33 },
        { startedAt: new Date('2026-09-29T10:00:00Z'), score: 68 },
      ],
    })

    expect(eventos.map((e) => e.texto)).toEqual([
      'O site entra em acompanhamento.',
      '2 pontos a melhorar detetados, nenhum grave: falta uma política de conteúdo permitido; o site pode ser embebido dentro de outro.',
      'Primeira medição de velocidade em telemóvel: 33/100.',
      'Aviso enviado ao cliente: «O vosso DMARC».',
      'Corrigido: o site pode ser embebido dentro de outro.',
      'Velocidade em telemóvel: 68/100, +35 pontos no mês.',
    ])
  })

  it('deixa de fora o que aconteceu fora do período', () => {
    const eventos = buildTimeline({
      ...base,
      findings: [{ code: 'missing_csp', title: 'x', severity: 'low', firstSeenAt: new Date('2026-08-10T09:00:00Z') }],
    })
    expect(eventos).toEqual([])
  })

  it('com demasiados registos, diz quantos ficaram de fora em vez de os cortar em silêncio', () => {
    const eventos = buildTimeline({
      ...base,
      notices: Array.from({ length: 30 }, (_, i) => ({
        sentAt: new Date(Date.UTC(2026, 8, 1 + (i % 28), 9)),
        subject: `Aviso ${i}`,
      })),
    })
    expect(eventos).toHaveLength(14)
    expect(eventos.some((e) => /… e mais 17 registos/.test(e.texto))).toBe(true)
  })
})
