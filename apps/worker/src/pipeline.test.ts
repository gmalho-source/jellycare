import { CHECK_REGISTRY } from '@jellycare/checks'
import { CONNECTOR_CHECKS } from '@jellycare/connectors'
import { FORM_CHECKS } from '@jellycare/forms'
import { createDatabase, schema, type Database } from '@jellycare/db'
import type { Queue } from 'bullmq'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { RecordingNotifier } from './channels.js'
import { createCheckQueue, checkJobId } from './queues.js'
import { executeCheckJob } from './runner.js'
import type { CheckJobData } from './runner.js'
import { tick } from './scheduler.js'

/**
 * Ciclo completo com Postgres e Redis reais: agendar, executar, persistir,
 * notificar.
 *
 * Os testes unitários cobrem cada peça; este cobre as costuras entre elas, que
 * é onde uma plataforma de monitorização falha silenciosamente.
 */

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:56379'

const redisConnection = (() => {
  const url = new URL(REDIS_URL)
  return { host: url.hostname, port: Number(url.port || 6379) }
})()

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 4 })

let server: Server
let baseUrl: string
let siteId: string
let organizationId: string
let queue: Queue
let siteResponds = true

beforeEach(async () => {
  // Apenas os dados deste ficheiro: um `delete` global apagaria por baixo dos
  // pés dos testes de outros pacotes a correr em paralelo.
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Cliente', slug: `cliente-${Date.now()}-${Math.random()}` })
    .returning({ id: schema.organizations.id })
  organizationId = org!.id

  const [site] = await db
    .insert(schema.sites)
    .values({
      organizationId,
      label: 'Site do cliente',
      url: baseUrl,
      hostname: '127.0.0.1',
      state: 'active',
      expectedContent: 'Bem-vindo',
    })
    .returning({ id: schema.sites.id })
  siteId = site!.id

  siteResponds = true
})

afterAll(async () => {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId))
  }
  await queue?.obliterate({ force: true }).catch(() => {})
  await queue?.close()
  await close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// eslint-disable-next-line @typescript-eslint/no-floating-promises
await new Promise<void>((resolve) => {
  server = createServer((_req, res) => {
    if (!siteResponds) {
      res.writeHead(503, { 'content-type': 'text/html' })
      res.end('<html><body>Serviço indisponível</body></html>')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><body><h1>Bem-vindo</h1></body></html>')
  })
  server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    queue = createCheckQueue(redisConnection)
    resolve()
  })
})

async function addCheck(checkType: string, intervalMinutes = 5, nextRunAt: Date | null = null) {
  await db.insert(schema.checkConfigs).values({
    siteId,
    checkType,
    intervalMinutes,
    enabled: true,
    config: checkType === 'uptime' ? { expectedContent: 'Bem-vindo' } : {},
    nextRunAt,
  })
}

async function verifySite() {
  await db.insert(schema.siteVerifications).values({
    siteId,
    method: 'dns_txt',
    token: 'jellycare-verificacao-abc',
    state: 'verified',
    verifiedAt: new Date(),
  })
}

async function addTarget(minSeverity: 'critical' | 'high' | 'medium' = 'high') {
  const [target] = await db
    .insert(schema.notificationTargets)
    .values({
      organizationId,
      channel: 'email',
      destination: 'alertas@cliente.pt',
      minSeverity,
    })
    .returning({ id: schema.notificationTargets.id })
  return target!.id
}

function run(notifier = new RecordingNotifier(), checkType = 'uptime', region = 'eu-west') {
  return executeCheckJob({ db, notifier, region }, { siteId, checkType })
}

async function samples() {
  return db
    .select()
    .from(schema.uptimeSamples)
    .where(eq(schema.uptimeSamples.siteId, siteId))
    .orderBy(schema.uptimeSamples.observedAt)
}

async function openFindings() {
  return db.select().from(schema.findings).where(eq(schema.findings.siteId, siteId))
}

/** Grava uma observação de outra região, como faria um segundo worker. */
async function sampleFromRegion(region: string, up: boolean, agoMs = 60_000) {
  await db.insert(schema.uptimeSamples).values({
    siteId,
    region,
    observedAt: new Date(Date.now() - agoMs),
    up,
    statusCode: up ? 200 : null,
    responseTimeMs: up ? 150 : null,
    failureReason: up ? null : 'connection_refused',
  })
}

describe('ciclo completo do worker', () => {
  it('executa um check, regista o run e não alerta quando está tudo bem', async () => {
    await addCheck('uptime')
    await addTarget()
    const notifier = new RecordingNotifier()

    const outcome = await run(notifier)

    expect(outcome.status).toBe('completed')
    const runs = await db.select().from(schema.checkRuns).where(eq(schema.checkRuns.siteId, siteId))
    expect(runs[0]?.status).toBe('ok')
    expect(runs[0]?.metrics.up).toBe(1)
    expect(notifier.sent).toHaveLength(0)
  })

  it('deteta a queda, persiste o finding e alerta ao confirmar', async () => {
    await addCheck('uptime')
    await addTarget()
    const notifier = new RecordingNotifier()

    siteResponds = false

    // O uptime exige duas observações: a primeira abre o finding em pendente.
    await run(notifier)
    let findings = await db.select().from(schema.findings).where(eq(schema.findings.siteId, siteId))
    expect(findings[0]?.state).toBe('pending')
    expect(notifier.sent).toHaveLength(0)

    await run(notifier)
    findings = await db.select().from(schema.findings).where(eq(schema.findings.siteId, siteId))
    expect(findings[0]?.state).toBe('open')
    expect(notifier.sent).toHaveLength(1)
    expect(notifier.sent[0]?.rendered.subject).toContain('Site do cliente')
  })

  it('avisa da recuperação e fecha o finding', async () => {
    await addCheck('uptime')
    await addTarget()
    const notifier = new RecordingNotifier()

    siteResponds = false
    await run(notifier)
    await run(notifier)

    siteResponds = true
    await run(notifier)

    const findings = await db.select().from(schema.findings).where(eq(schema.findings.siteId, siteId))
    expect(findings[0]?.state).toBe('resolved')
    expect(notifier.sent).toHaveLength(2)
    expect(notifier.sent[1]?.rendered.text).toContain('Nenhuma ação é necessária')
  })

  it('regista cada tentativa de entrega, para poder responder a "porque não fomos avisados?"', async () => {
    await addCheck('uptime')
    const targetId = await addTarget()
    const notifier = new RecordingNotifier()

    siteResponds = false
    await run(notifier)
    await run(notifier)

    const deliveries = await db
      .select()
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.targetId, targetId))

    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]?.succeeded).toBe(true)
    expect(deliveries[0]?.findingId).not.toBeNull()
  })

  it('recusa checks de segurança sem propriedade do domínio comprovada', async () => {
    await addCheck('exposed_files')

    const outcome = await run(new RecordingNotifier(), 'exposed_files')

    expect(outcome).toMatchObject({ status: 'skipped' })
    expect((outcome as { reason: string }).reason).toContain('propriedade do domínio')

    // Nada foi pedido ao site nem registado.
    const runs = await db.select().from(schema.checkRuns).where(eq(schema.checkRuns.siteId, siteId))
    expect(runs).toHaveLength(0)
  })

  it('permite o check de segurança depois da verificação', async () => {
    await addCheck('exposed_files')
    await verifySite()

    const outcome = await run(new RecordingNotifier(), 'exposed_files')

    expect(outcome.status).toBe('completed')
  })

  it('o uptime corre sem verificação, porque não faz mais do que um visitante', async () => {
    await addCheck('uptime')
    const outcome = await run()
    expect(outcome.status).toBe('completed')
  })

  it('não corre num site pausado', async () => {
    await addCheck('uptime')
    await db.update(schema.sites).set({ state: 'paused' }).where(eq(schema.sites.id, siteId))

    const outcome = await run()
    expect(outcome).toMatchObject({ status: 'skipped' })
  })

  it('não corre num site arquivado', async () => {
    await addCheck('uptime')
    await db.update(schema.sites).set({ state: 'archived' }).where(eq(schema.sites.id, siteId))

    const outcome = await run()
    expect(outcome).toMatchObject({ status: 'skipped' })
  })

  it('corre a disponibilidade num site por verificar', async () => {
    // O painel promete que um site por verificar é monitorizado em
    // disponibilidade. Não era: ficava em `onboarding` e nem chegava a ser
    // agendado, portanto não corria nada — um cliente podia estar a pagar
    // com zero verificações.
    await addCheck('uptime')
    await db.update(schema.sites).set({ state: 'onboarding' }).where(eq(schema.sites.id, siteId))

    const outcome = await run()
    expect(outcome.status).toBe('completed')
  })

  it('num site por verificar, os checks de segurança continuam a não correr', async () => {
    // O que muda é só a disponibilidade. Examinar a configuração de um
    // domínio sem prova de propriedade continua fora de questão.
    await addCheck('security_headers')
    await db.update(schema.sites).set({ state: 'onboarding' }).where(eq(schema.sites.id, siteId))

    const outcome = await run(new RecordingNotifier(), 'security_headers')
    expect(outcome).toMatchObject({ status: 'skipped' })
  })

  it('suprime o alerta durante uma janela de manutenção mas regista o problema', async () => {
    await addCheck('uptime')
    await addTarget()
    const now = new Date()
    await db
      .update(schema.sites)
      .set({
        maintenanceWindows: [
          {
            start: new Date(now.getTime() - 3_600_000).toISOString(),
            end: new Date(now.getTime() + 3_600_000).toISOString(),
          },
        ],
      })
      .where(eq(schema.sites.id, siteId))

    const notifier = new RecordingNotifier()
    siteResponds = false
    await run(notifier)
    await run(notifier)

    const findings = await db.select().from(schema.findings).where(eq(schema.findings.siteId, siteId))
    expect(findings[0]?.state).toBe('open')
    expect(notifier.sent).toHaveLength(0)
  })
})

describe('disponibilidade multi-região', () => {
  it('grava uma amostra por execução, com a região e o tempo de resposta', async () => {
    await addCheck('uptime')
    await run()

    const rows = await samples()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ region: 'eu-west', up: true, statusCode: 200 })
    expect(rows[0]?.responseTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('grava a queda com a causa, para o cálculo de SLA', async () => {
    await addCheck('uptime')
    siteResponds = false
    await run()

    const rows = await samples()
    expect(rows[0]?.up).toBe(false)
    expect(rows[0]?.failureReason).toBeTruthy()
  })

  it('mantém o alerta crítico quando só existe uma região', async () => {
    await addCheck('uptime')
    await addTarget()
    const notifier = new RecordingNotifier()

    siteResponds = false
    await run(notifier)
    await run(notifier)

    const findings = await openFindings()
    expect(findings[0]?.code).toBe('site_down')
    expect(findings[0]?.severity).toBe('critical')
    expect(notifier.sent).toHaveLength(1)
  })

  it('mantém o crítico quando a outra região também não alcança o site', async () => {
    await addCheck('uptime')
    await sampleFromRegion('eu-central', false)

    siteResponds = false
    await run()
    await run()

    const findings = await openFindings()
    expect(findings[0]?.code).toBe('site_down')
  })

  it('degrada para problema de região quando outra região alcança o site', async () => {
    await addCheck('uptime')
    await addTarget('medium')
    await sampleFromRegion('eu-central', true)
    const notifier = new RecordingNotifier()

    siteResponds = false
    await run(notifier)
    await run(notifier)

    const findings = await openFindings()
    // O problema não é calado — continua registado — mas não se diz ao cliente
    // que o site caiu quando ele está de pé para quase toda a gente.
    expect(findings.map((f) => f.code)).toEqual(['site_unreachable_from_region'])
    expect(findings[0]?.severity).toBe('medium')
    expect(findings[0]?.discriminator).toBe('eu-west')
    expect(notifier.sent).toHaveLength(0)
  })

  it('ignora amostras antigas de outra região', async () => {
    await addCheck('uptime')
    await sampleFromRegion('eu-central', true, 60 * 60_000)

    siteResponds = false
    await run()
    await run()

    const findings = await openFindings()
    expect(findings[0]?.code).toBe('site_down')
  })

  it('amostras de duas regiões contam ambas para o histórico', async () => {
    await addCheck('uptime')
    await run(new RecordingNotifier(), 'uptime', 'eu-west')
    await run(new RecordingNotifier(), 'uptime', 'us-east')

    const rows = await samples()
    expect(rows.map((row) => row.region).sort()).toEqual(['eu-west', 'us-east'])
  })
})

describe('agendador', () => {
  /**
   * Lote maior do que a base de testes.
   *
   * O agendador leva por omissão os cem checks mais vencidos de toda a base,
   * que é o comportamento certo em produção. Só que a base de testes é
   * partilhada e vai acumulando: com centenas de checks vencidos deixados
   * por execuções anteriores, o check que este teste acabou de criar não
   * entrava no lote e o teste falhava sem nada estar partido — punha em
   * causa o agendador por causa da sujidade da base.
   *
   * Um lote grande faz o teste medir o que quer medir. O limite de cem
   * continua a ser o de produção e tem teste próprio em `schedule.test.ts`.
   */
  const LOTE = 10_000

  beforeEach(async () => {
    await queue.obliterate({ force: true })
  })

  /**
   * Jobs em fila para o site deste teste.
   *
   * O `tick` é o agendador global: varre os check configs de toda a base de
   * dados, como tem de ser em produção. A base de testes é partilhada com os
   * outros pacotes, que correm ao mesmo tempo, por isso contar a fila inteira
   * conta também o trabalho deles — era esta a origem da falha intermitente,
   * que só aparecia quando outro pacote tinha um check por correr no mesmo
   * instante. Contar só os deste site mede o que o teste quer medir.
   */
  async function queuedForSite() {
    const jobs = await queue.getJobs(['wait', 'delayed', 'active', 'paused', 'prioritized'])
    return jobs.filter((job) => job.data.siteId === siteId)
  }

  it('enfileira o que está vencido e adia o próximo run', async () => {
    await addCheck('uptime', 5, new Date(Date.now() - 60_000))

    const result = await tick({ db, queue, spreadMs: 0, batchSize: LOTE })

    // Limite inferior e não igualdade: o número total é global e depende do
    // que os outros pacotes tiverem em curso.
    expect(result.enqueued).toBeGreaterThanOrEqual(1)

    const queued = await queuedForSite()
    expect(queued.map((job) => job.id)).toHaveLength(1)

    const configs = await db
      .select()
      .from(schema.checkConfigs)
      .where(eq(schema.checkConfigs.siteId, siteId))
    expect(configs[0]?.nextRunAt?.getTime()).toBeGreaterThan(Date.now())
  })

  it('não enfileira o que ainda não venceu', async () => {
    await addCheck('uptime', 5, new Date(Date.now() + 600_000))

    await tick({ db, queue, spreadMs: 0, batchSize: LOTE })
    expect(await queuedForSite()).toHaveLength(0)
  })

  it('não duplica trabalho quando o agendador corre duas vezes', async () => {
    await addCheck('uptime', 5, new Date(Date.now() - 60_000))

    const now = new Date()
    await tick({ db, queue, spreadMs: 0, batchSize: LOTE, now: () => now })
    // Simula dois schedulers em paralelo durante um deploy, ou um retry.
    await db
      .update(schema.checkConfigs)
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.checkConfigs.siteId, siteId))
    await tick({ db, queue, spreadMs: 0, batchSize: LOTE, now: () => now })

    expect(await queuedForSite()).toHaveLength(1)
  })

  it('ignora sites que não estão ativos', async () => {
    await addCheck('uptime', 5, null)
    await db.update(schema.sites).set({ state: 'archived' }).where(eq(schema.sites.id, siteId))

    await tick({ db, queue, spreadMs: 0, batchSize: LOTE })
    expect(await queuedForSite()).toHaveLength(0)
  })

  it('um check que não entra na fila não leva os outros atrás', async () => {
    // O defeito que deixou a monitorização parada uma noite inteira: o `add`
    // de um check rebentava, a passagem morria antes de gravar as datas, e
    // nenhum dos outros checks ficava adiado. À tick seguinte repetia-se
    // tudo, de trinta em trinta segundos, sem nada correr e sem ninguém saber.
    const vencido = new Date(Date.now() - 60_000)
    await addCheck('uptime', 5, vencido)
    await addCheck('tls', 1440, vencido)

    const filaComFalha = {
      ...queue,
      add: (async (name: string, data: CheckJobData, opts: unknown) => {
        if (data.checkType === 'tls' && data.siteId === siteId) {
          throw new Error('Redis recusou o comando')
        }
        return queue.add(name, data as never, opts as never)
      }) as unknown as typeof queue.add,
    } as unknown as typeof queue

    await expect(
      tick({ db, queue: filaComFalha, spreadMs: 0, batchSize: LOTE }),
    ).rejects.toThrow('não entraram na fila')

    // O saudável entrou.
    const tipos = (await queuedForSite()).map((job) => job.data.checkType)
    expect(tipos).toContain('uptime')
    expect(tipos).not.toContain('tls')

    const configs = await db
      .select()
      .from(schema.checkConfigs)
      .where(eq(schema.checkConfigs.siteId, siteId))

    // O que entrou fica adiado.
    const uptime = configs.find((c) => c.checkType === 'uptime')
    expect(uptime?.nextRunAt?.getTime()).toBeGreaterThan(vencido.getTime())

    // O que não entrou continua vencido, para ser tentado outra vez já a
    // seguir. Adiá-lo era dizer que correu, e esperar um intervalo inteiro
    // por uma falha momentânea de fila.
    const tls = configs.find((c) => c.checkType === 'tls')
    expect(tls?.nextRunAt?.getTime()).toBe(vencido.getTime())
  })

  it('espalha o lote no tempo em vez de o despejar de uma vez', async () => {
    await addCheck('uptime', 5, null)
    await addCheck('tls', 1440, null)
    await addCheck('email_auth', 1440, null)

    await tick({ db, queue, spreadMs: 60_000, batchSize: LOTE })

    const jobs = await queuedForSite()
    const delayed = await Promise.all(jobs.map((job) => job.getState()))
    expect(delayed.filter((state) => state === 'delayed').length).toBeGreaterThan(0)
  })
})

describe('configuração da plataforma', () => {
  it('passa a chave do URLhaus ao check de reputação', async () => {
    // A chave é da Jellycare, não do cliente. Se não chegar ao check, ele não
    // tem fonte nenhuma e falha — o que é melhor do que correr às cegas, mas
    // só se a chave chegar quando existe.
    await addCheck('reputation', 1440, null)
    await verifySite()

    const chaves: (string | null)[] = []
    const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      chaves.push(new Headers(init?.headers).get('Auth-Key'))
      return new Response(JSON.stringify({ query_status: 'no_results' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof globalThis.fetch

    const outcome = await executeCheckJob(
      {
        db,
        notifier: new RecordingNotifier(),
        fetch: fetchStub,
        urlhausAuthKey: 'chave-da-plataforma',
      },
      { siteId, checkType: 'reputation' },
    )

    expect(outcome.status).toBe('completed')
    expect(chaves).toContain('chave-da-plataforma')
  })

  it('não inventa uma chave quando ela não está definida', async () => {
    await addCheck('reputation', 1440, null)
    await verifySite()

    const pedidos: string[] = []
    const fetchStub = (async (input: RequestInfo | URL) => {
      pedidos.push(typeof input === 'string' ? input : String(input))
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof globalThis.fetch

    await executeCheckJob(
      { db, notifier: new RecordingNotifier(), fetch: fetchStub },
      { siteId, checkType: 'reputation' },
    )

    // Sem chave, a fonte é saltada e não chamada às cegas.
    expect(pedidos).toEqual([])
  })

  it('nunca chama a Safe Browsing da Google', async () => {
    // Foi retirada por licença: a API v4 é "for non-commercial use only" e o
    // Jellycare é vendido. O teste está aqui para a remoção não ser desfeita.
    await addCheck('reputation', 1440, null)
    await verifySite()

    const pedidos: string[] = []
    const fetchStub = (async (input: RequestInfo | URL) => {
      pedidos.push(typeof input === 'string' ? input : String(input))
      return new Response(JSON.stringify({ query_status: 'no_results' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof globalThis.fetch

    await executeCheckJob(
      {
        db,
        notifier: new RecordingNotifier(),
        fetch: fetchStub,
        urlhausAuthKey: 'chave-da-plataforma',
      },
      { siteId, checkType: 'reputation' },
    )

    expect(pedidos.some((url) => url.includes('googleapis.com'))).toBe(false)
  })

  it('passa a chave da PageSpeed ao check de velocidade', async () => {
    await addCheck('page_speed', 1440, null)
    await verifySite()

    const pedidos: string[] = []
    const fetchStub = (async (input: RequestInfo | URL) => {
      pedidos.push(typeof input === 'string' ? input : String(input))
      return new Response(
        JSON.stringify({
          lighthouseResult: { categories: { performance: { score: 0.93 } }, audits: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof globalThis.fetch

    const outcome = await executeCheckJob(
      {
        db,
        notifier: new RecordingNotifier(),
        fetch: fetchStub,
        pageSpeedApiKey: 'chave-pagespeed',
      },
      { siteId, checkType: 'page_speed' },
    )

    expect(outcome.status).toBe('completed')
    expect(
      pedidos.some(
        (url) => url.includes('pagespeedonline') && url.includes('chave-pagespeed'),
      ),
    ).toBe(true)
  })

  it('diz o nome da variável em falta em vez de falhar em silêncio', async () => {
    await addCheck('page_speed', 1440, null)
    await verifySite()

    await executeCheckJob(
      { db, notifier: new RecordingNotifier() },
      { siteId, checkType: 'page_speed' },
    )

    const runs = await db
      .select()
      .from(schema.checkRuns)
      .where(
        and(eq(schema.checkRuns.siteId, siteId), eq(schema.checkRuns.checkType, 'page_speed')),
      )

    // Um segredo com o nome errado é indistinguível de um segredo em falta, e
    // ambos são indistinguíveis de um check partido — a não ser que o erro
    // guardado diga qual é o nome que ele procurou.
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('failed')
    expect(runs[0]?.error).toContain('GOOGLE_PAGESPEED_API_KEY')
  })
})

describe('checkJobId', () => {
  it('é estável dentro do mesmo minuto e muda depois', () => {
    const data = { siteId: 's', checkType: 'uptime' }
    const base = new Date('2026-09-17T10:00:10Z')

    expect(checkJobId(data, base)).toBe(checkJobId(data, new Date('2026-09-17T10:00:50Z')))
    expect(checkJobId(data, base)).not.toBe(checkJobId(data, new Date('2026-09-17T10:01:10Z')))
  })
})

describe('registo de checks', () => {
  /**
   * Todo o tipo de check que o painel oferece tem de ser reconhecido pelo
   * runner.
   *
   * Este teste existe porque o `wp_inventory` esteve em produção sem correr
   * uma única vez: o job estava escrito, o dispatch estava escrito, e a
   * consulta de metadados que vem antes dos dois não conhecia os checks de
   * conector. O único sinal era uma linha nos logs a dizer "Check
   * desconhecido", e nada no painel dizia que faltava alguma coisa.
   *
   * A lista de tipos vem das mesmas fontes que o painel usa para os oferecer,
   * portanto um pacote de checks novo é apanhado aqui sem ninguém se lembrar
   * de acrescentar nada.
   */
  it('o runner reconhece todos os tipos que o painel oferece', async () => {
    const oferecidos = [
      ...Object.values(CHECK_REGISTRY).map((check) => check.definition.type),
      ...Object.values(FORM_CHECKS).map((check) => check.type),
      ...Object.values(CONNECTOR_CHECKS).map((check) => check.type),
    ]

    const desconhecidos: string[] = []
    for (const checkType of oferecidos) {
      const outcome = await executeCheckJob(
        { db, notifier: new RecordingNotifier(), region: 'eu-west' },
        { siteId, checkType },
      )
      if (outcome.status === 'skipped' && outcome.reason.startsWith('Check desconhecido')) {
        desconhecidos.push(checkType)
      }
    }

    expect(desconhecidos).toEqual([])
  }, 120_000)
})
