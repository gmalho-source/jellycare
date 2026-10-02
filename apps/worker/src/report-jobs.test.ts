import { createDatabase, latestReportRequest, requestReport, schema } from '@jellycare/db'
import { monthPeriod } from '@jellycare/reports'
import { existsSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBrowserPool } from './browser-pool.js'
import {
  generatePendingReports,
  generateReport,
  lerAvisosEnviados,
  regenerateReport,
  runReportRequests,
  type ReportMessage,
} from './report-jobs.js'

/**
 * Geração e envio dos relatórios, contra Postgres e browser reais.
 *
 * O que interessa verificar aqui é o ciclo de vida: que a rotina pode correr
 * de hora a hora sem duplicar, que o relatório sobrevive a uma falha de envio,
 * e que os números que chegam ao cliente saem mesmo dos dados do período.
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 4 })

const TIME_ZONE = 'Europe/Lisbon'
const PERIOD = monthPeriod(2026, 6, TIME_ZONE)
const INTERVAL = 5 * 60_000
/** Dia 5 de julho: já passou o dia de envio configurado. */
const DEPOIS_DO_PERIODO = new Date('2026-07-05T09:00:00Z')

const pool = createBrowserPool(
  existsSync('/opt/pw-browsers/chromium')
    ? { executablePath: '/opt/pw-browsers/chromium', noSandbox: true }
    : { noSandbox: true },
)

let organizationId: string
let siteId: string
let sent: ReportMessage[] = []

const deps = (overrides: Record<string, unknown> = {}) => ({
  db,
  browser: pool.get,
  timeZone: TIME_ZONE,
  now: DEPOIS_DO_PERIODO,
  sendReport: async (message: ReportMessage) => {
    sent.push(message)
  },
  ...overrides,
})

beforeEach(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  sent = []

  const [org] = await db
    .insert(schema.organizations)
    .values({
      name: 'Cliente Relatório',
      slug: `relatorio-${Date.now()}-${Math.random()}`,
      reportSendDay: 3,
    })
    .returning({ id: schema.organizations.id })
  organizationId = org!.id

  const [site] = await db
    .insert(schema.sites)
    .values({
      organizationId,
      label: 'Site do cliente',
      url: 'https://cliente.pt',
      hostname: 'cliente.pt',
      state: 'active',
      slaTarget: 99.9,
      reportRecipients: ['cliente@exemplo.pt'],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    .returning({ id: schema.sites.id })
  siteId = site!.id
})

afterAll(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  await pool.close()
  await close()
})

/** Amostras de disponibilidade cobrindo o período, com uma interrupção opcional. */
async function seedUptime(downFrom = -1, downTo = -1) {
  const total = Math.round((PERIOD.end.getTime() - PERIOD.start.getTime()) / INTERVAL)
  const rows = Array.from({ length: total }, (_, index) => {
    const down = index >= downFrom && index <= downTo
    return {
      siteId,
      region: 'eu-west',
      observedAt: new Date(PERIOD.start.getTime() + index * INTERVAL),
      up: !down,
      statusCode: down ? 503 : 200,
      responseTimeMs: down ? null : 200,
      failureReason: down ? 'HTTP 503' : null,
    }
  })

  // Em lotes: oito mil linhas numa só instrução esbarram no limite de
  // parâmetros do Postgres.
  for (let index = 0; index < rows.length; index += 1000) {
    await db.insert(schema.uptimeSamples).values(rows.slice(index, index + 1000))
  }
}

async function storedReports() {
  return db.select().from(schema.reports).where(eq(schema.reports.siteId, siteId))
}

describe('generateReport', () => {
  it('gera o relatório com PDF e números do período', async () => {
    await seedUptime(100, 130)

    const outcome = await generateReport(deps(), siteId, PERIOD)
    expect(outcome.status).toBe('generated')

    const [report] = await storedReports()
    expect(report?.periodYear).toBe(2026)
    expect(report?.periodMonth).toBe(6)
    expect(report?.fileName).toBe('jellycare-cliente-pt-2026-06.pdf')
    expect(report?.pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(report?.highlights.incidents).toBe(1)
    expect(report?.highlights.uptimePercent).toBeLessThan(100)
  }, 120_000)

  it('envia por email aos destinatários configurados, com o PDF anexado', async () => {
    await seedUptime()

    await generateReport(deps(), siteId, PERIOD)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toEqual(['cliente@exemplo.pt'])
    expect(sent[0]?.subject).toContain('junho de 2026')
    expect(sent[0]?.attachment.content.subarray(0, 5).toString()).toBe('%PDF-')

    const [report] = await storedReports()
    expect(report?.sentAt).not.toBeNull()
    expect(report?.sentTo).toEqual(['cliente@exemplo.pt'])
  }, 120_000)

  it('envia também aos contactos da organização marcados para receber relatórios', async () => {
    await seedUptime()
    await db.insert(schema.organizationContacts).values([
      { organizationId, name: 'Ana', jobTitle: 'Marketing', email: 'ana@exemplo.pt', receivesReports: true },
      { organizationId, name: 'Contas', email: 'contas@exemplo.pt', receivesReports: false },
    ])

    await generateReport(deps(), siteId, PERIOD)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toEqual(['cliente@exemplo.pt', 'ana@exemplo.pt'])
    const [report] = await storedReports()
    expect(report?.sentTo).toEqual(['cliente@exemplo.pt', 'ana@exemplo.pt'])
  }, 120_000)

  it('não gera duas vezes o mesmo período', async () => {
    await seedUptime()

    await generateReport(deps(), siteId, PERIOD)
    const segunda = await generateReport(deps(), siteId, PERIOD)

    expect(segunda).toMatchObject({ status: 'skipped' })
    expect(await storedReports()).toHaveLength(1)
    expect(sent).toHaveLength(1)
  }, 120_000)

  it('guarda o relatório mesmo quando o envio falha', async () => {
    await seedUptime()

    const outcome = await generateReport(
      deps({
        sendReport: async () => {
          throw new Error('Resend respondeu 500')
        },
      }),
      siteId,
      PERIOD,
    )

    // Perder o relatório por causa do email seria o pior dos dois males: fica
    // gerado e acessível no painel, com o erro registado.
    expect(outcome).toMatchObject({ status: 'generated', sentTo: [] })
    const [report] = await storedReports()
    expect(report?.sendError).toContain('500')
    expect(report?.sentAt).toBeNull()
  }, 120_000)

  it('gera sem enviar quando não há destinatários', async () => {
    await seedUptime()
    await db.update(schema.sites).set({ reportRecipients: [] }).where(eq(schema.sites.id, siteId))

    const outcome = await generateReport(deps(), siteId, PERIOD)

    expect(outcome).toMatchObject({ status: 'generated', sentTo: [] })
    expect(sent).toHaveLength(0)
  }, 120_000)

  it('usa a marca da organização no relatório white-label', async () => {
    await seedUptime()
    await db
      .update(schema.organizations)
      .set({ brandName: 'Estúdio X', brandUrl: 'https://estudiox.pt' })
      .where(eq(schema.organizations.id, organizationId))

    await generateReport(deps(), siteId, PERIOD)

    expect(sent[0]?.text).toContain('Estúdio X')
  }, 120_000)

  it('respeita o SLA configurado no site', async () => {
    // Uma interrupção de 31 amostras em ~8900 fica abaixo de 99,9%.
    await seedUptime(100, 130)
    await db.update(schema.sites).set({ slaTarget: 99.9 }).where(eq(schema.sites.id, siteId))

    await generateReport(deps(), siteId, PERIOD)
    const [report] = await storedReports()

    expect(report?.highlights.slaMet).toBe(false)
  }, 120_000)
})

describe('generatePendingReports', () => {
  it('gera o relatório do mês anterior depois do dia configurado', async () => {
    await seedUptime()

    const result = await generatePendingReports(deps())

    expect(result.generated).toBe(1)
    expect(result.sent).toBe(1)
    const [report] = await storedReports()
    expect(report?.periodMonth).toBe(6)
  }, 120_000)

  it('espera pelo dia de envio configurado', async () => {
    await seedUptime()

    // Dia 2 de julho, com envio configurado para o dia 3.
    const result = await generatePendingReports(
      deps({ now: new Date('2026-07-02T09:00:00Z') }),
    )

    expect(result.generated).toBe(0)
    expect(await storedReports()).toHaveLength(0)
  }, 120_000)

  it('é idempotente: correr de hora a hora não duplica', async () => {
    await seedUptime()

    await generatePendingReports(deps())
    const segunda = await generatePendingReports(deps())

    expect(segunda.generated).toBe(0)
    expect(await storedReports()).toHaveLength(1)
  }, 120_000)

  it('ignora sites que não estão ativos', async () => {
    await seedUptime()
    await db.update(schema.sites).set({ state: 'paused' }).where(eq(schema.sites.id, siteId))

    const result = await generatePendingReports(deps())
    expect(result.generated).toBe(0)
  }, 120_000)

  it('ignora sites criados depois do período', async () => {
    // Um site adicionado em julho não tem junho para reportar.
    await db
      .update(schema.sites)
      .set({ createdAt: new Date('2026-07-01T12:00:00Z') })
      .where(eq(schema.sites.id, siteId))

    const result = await generatePendingReports(deps())
    expect(result.generated).toBe(0)
  }, 120_000)

  it('gera relatório mesmo num mês sem dados nenhuns', async () => {
    const result = await generatePendingReports(deps())

    // O silêncio também é informação: o cliente recebe o relatório a dizer que
    // não houve observações, em vez de não receber nada e ficar sem saber.
    expect(result.generated).toBe(1)
    const [report] = await storedReports()
    expect(report?.highlights.uptimePercent).toBeNull()
    expect(report?.highlights.summary[0]).toContain('Não houve observações')
  }, 120_000)
})

describe('regenerateReport', () => {
  it('substitui um relatório já gerado', async () => {
    await seedUptime()
    await generateReport(deps(), siteId, PERIOD)
    const [primeiro] = await storedReports()

    const outcome = await regenerateReport(deps(), siteId, 2026, 6)

    expect(outcome.status).toBe('generated')
    const reports = await storedReports()
    expect(reports).toHaveLength(1)
    expect(reports[0]?.id).not.toBe(primeiro?.id)
  }, 120_000)

  it('não toca em relatórios de outros períodos', async () => {
    await seedUptime()
    await generateReport(deps(), siteId, PERIOD)
    await generateReport(deps(), siteId, monthPeriod(2026, 5, TIME_ZONE))

    await regenerateReport(deps(), siteId, 2026, 6)

    const maio = await db
      .select()
      .from(schema.reports)
      .where(and(eq(schema.reports.siteId, siteId), eq(schema.reports.periodMonth, 5)))
    expect(maio).toHaveLength(1)
  }, 180_000)
})


describe('notas da equipa e módulos', () => {
  async function nota(body: string, mode: 'persistent' | 'next_only', ajustes = {}) {
    const [criada] = await db
      .insert(schema.reportNotes)
      .values({ siteId, body, mode, ...ajustes })
      .returning({ id: schema.reportNotes.id })
    return criada!.id
  }

  it('uma nota «só no próximo» entra uma vez e fica presa a esse relatório', async () => {
    const id = await nota('Migrámos o site para o novo alojamento.', 'next_only')

    const junho = await generateReport(deps(), siteId, PERIOD)
    expect(junho.status === 'generated' && junho.notes).toEqual([id])

    const [guardada] = await db.select().from(schema.reportNotes).where(eq(schema.reportNotes.id, id))
    expect(guardada!.reportId).toBe(junho.status === 'generated' ? junho.reportId : null)

    // O relatório seguinte já não a leva.
    const julho = await generateReport(deps(), siteId, monthPeriod(2026, 7, TIME_ZONE))
    expect(julho.status === 'generated' && julho.notes).toEqual([])
  }, 120_000)

  it('uma nota persistente entra em todos, e várias podem coexistir', async () => {
    // Acrescentar uma nota nova nunca obriga a mexer numa persistente que já
    // lá esteja: as duas entram, pela ordem em que foram escritas.
    const contrato = await nota('O contrato inclui 2 horas mensais de alterações.', 'persistent')
    const avulsa = await nota('Este mês corrigimos o formulário de orçamentos.', 'next_only')

    const junho = await generateReport(deps(), siteId, PERIOD)
    expect(junho.status === 'generated' && junho.notes).toEqual([contrato, avulsa])

    const julho = await generateReport(deps(), siteId, monthPeriod(2026, 7, TIME_ZONE))
    expect(julho.status === 'generated' && julho.notes).toEqual([contrato])
  }, 120_000)

  it('uma nota retirada não entra', async () => {
    await nota('Já não se aplica.', 'persistent', { archivedAt: new Date() })
    const junho = await generateReport(deps(), siteId, PERIOD)
    expect(junho.status === 'generated' && junho.notes).toEqual([])
  }, 120_000)

  it('regenerar o relatório devolve-lhe a nota «só no próximo» em vez de a perder', async () => {
    // Regenerar apaga o relatório e volta a gerá-lo. Sem o `set null`, a nota
    // ficava presa a um relatório que já não existe e desaparecia da versão
    // nova — que é precisamente a que o cliente vai receber.
    const id = await nota('Nota do mês.', 'next_only')
    await generateReport(deps(), siteId, PERIOD)

    const outraVez = await regenerateReport(deps(), siteId, 2026, 6)
    expect(outraVez.status === 'generated' && outraVez.notes).toEqual([id])
    const [guardada] = await db.select().from(schema.reportNotes).where(eq(schema.reportNotes.id, id))
    expect(guardada!.reportId).toBe(outraVez.status === 'generated' ? outraVez.reportId : null)
  }, 120_000)

  it('deixa de fora os módulos tirados no site', async () => {
    await db
      .update(schema.sites)
      .set({ reportExcludedSections: ['desempenho', 'trabalho'] })
      .where(eq(schema.sites.id, siteId))

    const junho = await generateReport(deps(), siteId, PERIOD)
    expect(junho.status === 'generated' && junho.sections).not.toContain('desempenho')
    expect(junho.status === 'generated' && junho.sections).not.toContain('trabalho')
    expect(junho.status === 'generated' && junho.sections).toContain('disponibilidade')
  }, 120_000)

  it('só leva o módulo de WordPress quando há ligação', async () => {
    const sem = await generateReport(deps(), siteId, PERIOD)
    expect(sem.status === 'generated' && sem.sections).not.toContain('wordpress')

    await db.insert(schema.connectors).values({ siteId, type: 'wp_umbrella', externalId: '1' })
    const com = await regenerateReport(deps(), siteId, 2026, 6)
    expect(com.status === 'generated' && com.sections).toContain('wordpress')
  }, 120_000)
})

describe('runReportRequests', () => {
  it('envia para o destinatário escolhido no pedido, e não para os configurados', async () => {
    // O caso de uso: mandar o relatório a um contacto novo do cliente, ou a
    // si próprio antes de uma reunião, sem alterar a configuração do site e
    // sem passar a mandá-lo para lá todos os meses.
    await requestReport(db, { siteId, recipients: ['pontual@exemplo.pt'] })

    await runReportRequests(deps())

    // Filtra-se em vez de se contar o total: a função processa todos os
    // pedidos pendentes da base de dados, como tem de ser, e a base de testes
    // é partilhada com os outros pacotes a correr em paralelo.
    const meus = sent.filter((message) => message.to.includes('pontual@exemplo.pt'))
    expect(meus).toHaveLength(1)
  }, 120_000)

  it('sem destinatário escolhido, vai para os configurados no site', async () => {
    await requestReport(db, { siteId })

    await runReportRequests(deps())

    expect(sent.filter((message) => message.to.includes('cliente@exemplo.pt'))).toHaveLength(1)
  }, 120_000)

  it('marca o pedido como concluído, com o período e para quem foi', async () => {
    const { request } = await requestReport(db, { siteId, recipients: ['pontual@exemplo.pt'] })

    await runReportRequests(deps())

    const depois = await latestReportRequest(db, siteId)
    expect(depois?.id).toBe(request.id)
    expect(depois?.completedAt).not.toBeNull()
    expect(depois?.sentTo).toEqual(['pontual@exemplo.pt'])
    expect(depois?.periodMonth).toBeGreaterThan(0)
    expect(depois?.error).toBeNull()
  }, 120_000)

  it('um envio que falha fica registado e não bloqueia o site', async () => {
    // Deixar o pedido por concluir bloqueava o site para sempre: o índice
    // parcial não deixa criar outro enquanto houver um pendente.
    await requestReport(db, { siteId })

    await runReportRequests(
      deps({
        sendReport: async () => {
          throw new Error('SMTP recusou')
        },
      }),
    )

    const depois = await latestReportRequest(db, siteId)
    expect(depois?.completedAt).not.toBeNull()
  }, 120_000)

  it('não envia nada deste site quando ele não pediu nada', async () => {
    await runReportRequests(deps())

    expect(sent.filter((message) => message.to.includes('cliente@exemplo.pt'))).toHaveLength(0)
  }, 60_000)
})

describe('período sem monitorização e mês em curso', () => {
  /** O site passa a ter entrado na plataforma neste instante. */
  async function entrouEm(instante: Date) {
    await db.update(schema.sites).set({ createdAt: instante }).where(eq(schema.sites.id, siteId))
  }

  it('não gera o relatório de um mês em que o site ainda não era acompanhado', async () => {
    await entrouEm(new Date('2026-07-02T10:00:00Z'))

    const outcome = await generateReport(deps(), siteId, PERIOD)

    // O PDF saía na mesma, a dizer que não houve observações — verdade, e lida
    // como avaria.
    expect(outcome).toMatchObject({ status: 'skipped' })
    expect(outcome.status === 'skipped' && outcome.reason).toContain('só é acompanhado desde 02/07/2026')
    expect(await storedReports()).toHaveLength(0)
  })

  it('conta a disponibilidade sobre os dias vigiados de um site que entrou a meio do mês', async () => {
    // Entrou a 22 de junho e foi vigiado sem falhas desde então.
    const entrada = new Date('2026-06-22T08:00:00Z')
    await entrouEm(entrada)
    const total = Math.round((PERIOD.end.getTime() - entrada.getTime()) / INTERVAL)
    const linhas = Array.from({ length: total }, (_, index) => ({
      siteId,
      region: 'eu-west',
      observedAt: new Date(entrada.getTime() + index * INTERVAL),
      up: true,
      statusCode: 200,
      responseTimeMs: 200,
    }))
    for (let index = 0; index < linhas.length; index += 1000) {
      await db.insert(schema.uptimeSamples).values(linhas.slice(index, index + 1000))
    }

    await generateReport(deps(), siteId, PERIOD)

    // Contado sobre o mês inteiro, nove dias dariam menos de metade de
    // cobertura e nenhum juízo sobre o SLA.
    const [relatorio] = await storedReports()
    expect(relatorio?.highlights.slaMet).toBe(true)
    expect(relatorio?.highlights.uptimePercent).toBe(100)
  })

  it('um pedido do último mês completo, sem monitorização, fica concluído com a razão e não apaga nada', async () => {
    await entrouEm(new Date('2026-07-02T10:00:00Z'))
    await requestReport(db, { siteId })

    await runReportRequests(deps())

    const pedido = await latestReportRequest(db, siteId)
    expect(pedido?.completedAt).not.toBeNull()
    expect(pedido?.error).toContain('Peça o mês em curso')
    expect(sent).toHaveLength(0)
  })

  it('o mês em curso gera um relatório provisório, que o do mês completo substitui', async () => {
    // A 30 de junho, o cliente novo pede o mês em curso.
    await entrouEm(new Date('2026-06-22T08:00:00Z'))
    await requestReport(db, { siteId, scope: 'month_to_date' })
    await runReportRequests(deps({ now: new Date('2026-06-30T10:00:00Z') }))

    const [provisorio] = await storedReports()
    expect(provisorio).toMatchObject({ periodYear: 2026, periodMonth: 6, partial: true })
    expect(sent[0]?.subject).toContain('junho de 2026 (até 30/06)')

    // A 5 de julho sai o do mês completo — em vez de ser impedido pelo
    // provisório, que era o que o índice único fazia.
    await generatePendingReports(deps())

    const depois = await storedReports()
    expect(depois).toHaveLength(1)
    expect(depois[0]).toMatchObject({ periodMonth: 6, partial: false })
    expect(depois[0]?.id).not.toBe(provisorio?.id)
  })

  it('um relatório completo não é substituído por um pedido do mês em curso de outro mês', async () => {
    await generateReport(deps(), siteId, PERIOD)
    await requestReport(db, { siteId, scope: 'month_to_date' })
    await runReportRequests(deps())

    // O mês em curso a 5 de julho é julho: o de junho fica onde estava.
    const guardados = await storedReports()
    expect(guardados.map((r) => [r.periodMonth, r.partial]).sort()).toEqual([
      [6, false],
      [7, true],
    ])
  })
})

describe('avisos no registo de atividade', () => {
  it('leva os avisos que saíram no período, e não os que falharam', async () => {
    const [problema] = await db
      .insert(schema.findings)
      .values({
        siteId,
        checkType: 'email_auth',
        fingerprint: `aviso-relatorio-${Date.now()}`,
        code: 'dmarc_policy_none',
        severity: 'low',
        state: 'open',
        title: 'DMARC',
        firstSeenAt: new Date('2026-06-02T09:00:00Z'),
        lastSeenAt: new Date('2026-06-02T09:00:00Z'),
      })
      .returning({ id: schema.findings.id })
    await db.insert(schema.clientNotifications).values([
      { findingId: problema!.id, recipients: ['a@b.pt'], subject: 'Saiu', body: 'x', sentAt: new Date('2026-06-10T09:00:00Z') },
      // Tentado e falhado: não chegou ao cliente.
      { findingId: problema!.id, recipients: ['a@b.pt'], subject: 'Falhou', body: 'x', error: 'Resend 500' },
      // Fora do período.
      { findingId: problema!.id, recipients: ['a@b.pt'], subject: 'Julho', body: 'x', sentAt: new Date('2026-07-02T09:00:00Z') },
    ])

    const avisos = await lerAvisosEnviados(db, siteId, PERIOD)
    expect(avisos.map((a) => a.subject)).toEqual(['Saiu'])
  })
})
