import { schema, type Database } from '@jellycare/db'
import { CHECK_REGISTRY } from '@jellycare/checks'
import { and, eq, inArray, or } from 'drizzle-orm'
import type { Queue } from 'bullmq'
import { checkJobId } from './queues.js'
import type { CheckJobData } from './runner.js'
import { batchDelayMs, computeNextRun, selectDue, type SchedulableCheck } from './schedule.js'

export interface SchedulerOptions {
  db: Database
  queue: Queue<CheckJobData>
  /** Máximo de checks despachados por tick. */
  batchSize?: number
  /** Janela ao longo da qual o lote é espalhado. */
  spreadMs?: number
  now?: () => Date
  /**
   * Sob que nome a batida é gravada.
   *
   * Em produção há um agendador e o nome é sempre o mesmo. Isto existe porque
   * a linha da batida é única na tabela e partilhada por tudo o que fala com
   * a mesma base de dados: os testes do worker escreviam-na ao mesmo tempo
   * que os do painel a liam, e a asserção de «monitorização parada» passava
   * ou falhava conforme a ordem em que os dois processos calhavam correr.
   * Dar um nome próprio a quem está a testar separa-os por construção.
   */
  id?: string
}

export interface TickResult {
  considered: number
  enqueued: number
  /** Checks que não conseguiram entrar na fila nesta passagem. */
  failed: number
}

/**
 * Nem todos os checks entraram na fila.
 *
 * Lançado no fim da passagem, depois de os que entraram já terem a data
 * seguinte gravada. Falhar em voz alta é obrigatório — um agendador que não
 * enfileira e não se queixa deixa a plataforma cega sem ninguém dar por
 * isso — mas falhar antes de gravar o que correu bem é que era o defeito.
 */
export class EnqueueFailures extends Error {
  constructor(readonly failures: readonly string[]) {
    super(`${failures.length} checks não entraram na fila: ${failures.join('; ')}`)
    this.name = 'EnqueueFailures'
  }
}

/**
 * Um ciclo do agendador.
 *
 * `nextRunAt` é atualizado no momento em que o job é enfileirado, não quando
 * ele termina. Se fosse ao contrário, um check que ficasse pendurado seria
 * enfileirado outra vez a cada tick.
 */
/**
 * Os checks que podem correr sem propriedade comprovada.
 *
 * Derivado do registo e não escrito à mão: é a mesma fonte que o runner usa
 * para decidir o que recusa.
 */
const PUBLIC_CHECK_TYPES = Object.values(CHECK_REGISTRY)
  .filter((check) => check.access === 'public')
  .map((check) => check.definition.type)

export const SCHEDULER_ID = 'checks'

/**
 * Regista que o agendador passou por aqui.
 *
 * Escrito em todas as passagens, com sucesso ou sem ele. A pergunta que isto
 * responde não é «correu trabalho?» — é «o ciclo está vivo?». Numa noite sem
 * nada vencido, um agendador saudável não enfileira nada; um agendador morto
 * também não. Só a batida os distingue.
 */
async function recordHeartbeat(
  db: Database,
  now: Date,
  outcome: { result?: TickResult; error?: unknown },
  id: string,
): Promise<void> {
  const saudavel = outcome.error === undefined
  const mensagem =
    outcome.error === undefined
      ? null
      : outcome.error instanceof Error
        ? outcome.error.message
        : String(outcome.error)

  const valores = {
    lastTickAt: now,
    ...(saudavel ? { lastHealthyTickAt: now } : {}),
    ...(outcome.result && outcome.result.enqueued > 0 ? { lastEnqueueAt: now } : {}),
    considered: outcome.result?.considered ?? 0,
    enqueued: outcome.result?.enqueued ?? 0,
    failed: outcome.result?.failed ?? 0,
    ...(saudavel
      ? { lastError: null, lastErrorAt: null }
      : { lastError: mensagem, lastErrorAt: now }),
  }

  await db
    .insert(schema.schedulerHeartbeats)
    .values({ id, ...valores })
    .onConflictDoUpdate({ target: schema.schedulerHeartbeats.id, set: valores })
}

/**
 * Um ciclo, com a batida gravada aconteça o que acontecer.
 *
 * A gravação é o que sobrevive à falha: se o `tick` rebentar, o erro fica
 * guardado e depois é relançado. Foi a ausência disto que deixou uma avaria
 * de dezoito horas visível só nos registos, catorze mil vezes por minuto,
 * sem nenhum sítio onde uma pessoa a pudesse encontrar.
 */
export async function tick(options: SchedulerOptions): Promise<TickResult> {
  const agora = options.now?.() ?? new Date()
  const id = options.id ?? SCHEDULER_ID
  try {
    const result = await runTick(options, agora)
    await recordHeartbeat(options.db, agora, { result }, id)
    return result
  } catch (error) {
    // A batida primeiro. Se esta escrita também falhar, aí sim não há nada a
    // fazer — mas o Postgres e o Redis falham por razões diferentes, e foi
    // justamente por isso que a batida não vive no Redis.
    await recordHeartbeat(options.db, agora, { error }, id).catch(() => {})
    throw error
  }
}

async function runTick(options: SchedulerOptions, agora: Date): Promise<TickResult> {
  const now = agora
  const batchSize = options.batchSize ?? 100
  const spreadMs = options.spreadMs ?? 30_000

  const rows = await options.db
    .select({
      id: schema.checkConfigs.id,
      siteId: schema.checkConfigs.siteId,
      checkType: schema.checkConfigs.checkType,
      enabled: schema.checkConfigs.enabled,
      intervalMinutes: schema.checkConfigs.intervalMinutes,
      nextRunAt: schema.checkConfigs.nextRunAt,
    })
    .from(schema.checkConfigs)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.checkConfigs.siteId))
    // Um site por verificar tem de ser monitorizado em disponibilidade — é o
    // que o painel promete, e observar que um URL público responde não é
    // diferente do que faz qualquer visitante. Antes ficava de fora e não
    // corria nada: um cliente podia estar a pagar com zero verificações.
    //
    // Mas só os checks que podem mesmo correr sem prova de propriedade.
    // Enfileirar os outros era encher a fila de trabalho que o runner ia
    // recusar de certeza, e num site que ficasse meses por verificar isso
    // repetia-se a cada ciclo.
    //
    // A lista vem do registo de checks, que é a mesma fonte que o runner
    // consulta. Escrevê-la à mão aqui era uma segunda cópia da regra, e duas
    // cópias divergem.
    .where(
      and(
        eq(schema.checkConfigs.enabled, true),
        or(
          eq(schema.sites.state, 'active'),
          and(
            eq(schema.sites.state, 'onboarding'),
            inArray(schema.checkConfigs.checkType, PUBLIC_CHECK_TYPES),
          ),
        ),
      ),
    )

  const checks: SchedulableCheck[] = rows.map((row) => ({
    id: row.id,
    siteId: row.siteId,
    checkType: row.checkType,
    enabled: row.enabled,
    intervalMinutes: row.intervalMinutes,
    nextRunAt: row.nextRunAt,
  }))

  const due = selectDue(checks, now, batchSize)
  if (due.length === 0) return { considered: checks.length, enqueued: 0, failed: 0 }

  // Cada check entra na fila por sua conta. Antes, um `add` que rebentasse
  // levava a passagem inteira com ele — e como a gravação das datas só vinha
  // a seguir ao ciclo, nenhum dos outros ficava com `nextRunAt` novo. Um só
  // check problemático parava todos os outros, de trinta em trinta segundos,
  // em silêncio. Foi assim que a monitorização ficou parada uma noite
  // inteira sem ninguém saber.
  const enfileirados: SchedulableCheck[] = []
  const falhas: string[] = []

  for (const [index, check] of due.entries()) {
    const data: CheckJobData = { siteId: check.siteId, checkType: check.checkType }
    const delay = batchDelayMs(index, due.length, spreadMs)

    try {
      await options.queue.add(check.checkType, data, {
        jobId: checkJobId(data, now),
        delay,
      })
      enfileirados.push(check)
    } catch (error) {
      falhas.push(
        `${check.checkType}/${check.siteId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Só os que entraram mesmo. Adiar um check que não foi enfileirado era
  // dizer que ele correu, e ele voltaria a ser considerado só daqui a um
  // intervalo inteiro — o que transforma uma falha momentânea de fila numa
  // hora sem monitorização.
  const nextRunById = new Map(
    enfileirados.map((check) => [check.id, computeNextRun(check, now)] as const),
  )

  // Uma escrita por valor distinto em vez de uma por check: cem checks do
  // mesmo tipo e intervalo resolvem-se numa só query.
  const byTimestamp = new Map<number, string[]>()
  for (const [id, next] of nextRunById) {
    const key = next.getTime()
    const bucket = byTimestamp.get(key)
    if (bucket) bucket.push(id)
    else byTimestamp.set(key, [id])
  }

  for (const [timestamp, ids] of byTimestamp) {
    await options.db
      .update(schema.checkConfigs)
      .set({ nextRunAt: new Date(timestamp), lastRunAt: now })
      .where(inArray(schema.checkConfigs.id, ids))
  }

  if (falhas.length > 0) throw new EnqueueFailures(falhas)

  return { considered: checks.length, enqueued: enfileirados.length, failed: falhas.length }
}

export interface SchedulerLoop {
  stop: () => void
}

/** Arranca o agendador em ciclo. */
export function startScheduler(
  options: SchedulerOptions & { intervalMs?: number; onError?: (error: unknown) => void },
): SchedulerLoop {
  const intervalMs = options.intervalMs ?? 30_000
  let stopped = false

  const run = async () => {
    if (stopped) return
    try {
      await tick(options)
    } catch (error) {
      options.onError?.(error)
    }
  }

  const timer = setInterval(() => void run(), intervalMs)
  void run()

  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  }
}
