import { schema } from '@jellycare/db'
import { and, eq, gte, inArray, notInArray, sql } from 'drizzle-orm'
import { getDb } from './db'

/**
 * O agendador está vivo?
 *
 * A regra vive aqui e não no endpoint porque tem dois leitores: o vigia de
 * fora, que só quer um código HTTP, e o painel, que precisa de saber a mesma
 * coisa para não afirmar que está tudo bem. Duas cópias da regra divergiriam,
 * e a que divergisse seria a do painel — a que as pessoas veem.
 */

/**
 * A partir de quando é que o silêncio é avaria.
 *
 * O ciclo corre de 30 em 30 segundos. Cinco minutos são dez passagens
 * falhadas: folga que chega para um deploy ou um reinício, e pouca para uma
 * avaria passar despercebida. A paragem que motivou isto durou dezoito horas.
 */
export const STALE_AFTER_MS = 5 * 60_000

export type SchedulerStatus = 'ok' | 'stale' | 'failing' | 'unknown'

export interface SchedulerHealth {
  status: SchedulerStatus
  /** Segundos desde a última passagem. Nulo quando nunca houve nenhuma. */
  ageSeconds: number | null
  lastTickAt: Date | null
  lastHealthyTickAt: Date | null
  lastEnqueueAt: Date | null
  lastError: string | null
  lastErrorAt: Date | null
}

export async function getSchedulerHealth(now = new Date()): Promise<SchedulerHealth> {
  const db = getDb()

  const rows = await db
    .select()
    .from(schema.schedulerHeartbeats)
    .where(eq(schema.schedulerHeartbeats.id, 'checks'))
    .limit(1)

  const batida = rows[0]

  // Sem batida: ou o worker nunca arrancou com esta versão, ou não arranca.
  // Não é `ok` — não sabemos nada, e não saber é precisamente o estado que
  // isto existe para não deixar passar por bom.
  if (!batida) {
    return {
      status: 'unknown',
      ageSeconds: null,
      lastTickAt: null,
      lastHealthyTickAt: null,
      lastEnqueueAt: null,
      lastError: null,
      lastErrorAt: null,
    }
  }

  const ageMs = now.getTime() - batida.lastTickAt.getTime()

  // Três estados e não dois. «A passar mas a falhar» é o que aconteceu com o
  // Redis esgotado: o ciclo continuou vivo, de trinta em trinta segundos,
  // dezoito horas a fio, sem pôr nada na fila. Um sinal de vida que só
  // perguntasse «passou?» teria respondido «sim» o tempo todo.
  const status: SchedulerStatus =
    ageMs > STALE_AFTER_MS ? 'stale' : batida.lastError !== null ? 'failing' : 'ok'

  return {
    status,
    ageSeconds: Math.round(ageMs / 1000),
    lastTickAt: batida.lastTickAt,
    lastHealthyTickAt: batida.lastHealthyTickAt,
    lastEnqueueAt: batida.lastEnqueueAt,
    lastError: batida.lastError,
    lastErrorAt: batida.lastErrorAt,
  }
}

/* -------------------------------------------------------------------------- */
/* Vivacidade por tipo de verificação                                         */
/* -------------------------------------------------------------------------- */

/**
 * O agendador estar vivo não chega.
 *
 * A batida responde a «o ciclo está a enfileirar?». Não responde a «o
 * trabalho está a terminar?» — e um worker que enfileira alegremente e falha
 * todos os jobs passa no primeiro sinal sem tocar no segundo. É a classe de
 * falha a seguir à que nos apanhou, e do mesmo tipo: silenciosa.
 *
 * Isto é **derivado** de `check_runs`, sem tabela nova e sem caminho de
 * escrita novo. Um segundo sítio a gravar estado é mais uma coisa que pode
 * parar sem ninguém dar por ela, e o remédio não pode ter a doença.
 */

/**
 * Quanto tempo depois do intervalo é que um check está atrasado.
 *
 * `intervalo × 2 + 10 minutos`. A margem é generosa de propósito: um check de
 * 5 em 5 minutos tem 20 minutos de tolerância, o que chega para um deploy,
 * uma rajada de recuperação ou um site lento, e não chega para uma avaria
 * passar a noite. Um alarme que dispara com atrasos normais é um alarme que
 * se aprende a ignorar — e aí volta a valer zero.
 */
export function lateAfterMinutes(intervalMinutes: number): number {
  return Math.max(1, intervalMinutes) * 2 + 10
}

export interface CheckLiveness {
  checkType: string
  /** Pares site/check vigiados: ativos e com pelo menos um sucesso no passado. */
  tracked: number
  late: number
  /** O sucesso mais recente, de qualquer site. */
  lastSuccessAt: Date | null
  /** Minutos de atraso do pior caso. */
  worstLateMinutes: number | null
}

export interface TrackedConfig {
  siteId: string
  checkType: string
  intervalMinutes: number
}

export interface LastSuccess {
  siteId: string
  checkType: string
  at: Date
}

/**
 * Resume o estado por tipo de check.
 *
 * **Só entram pares que já tiveram sucesso pelo menos uma vez.** Um check que
 * nunca correu é um problema de configuração, não de vivacidade, e marcá-lo
 * como atrasado faria o alarme disparar a cada tipo novo que acrescentássemos
 * — o `page_speed` teria tocado o dia de hoje inteiro sem nada estar partido.
 * O sinal que interessa é «algo que funcionava deixou de funcionar».
 *
 * Conta sucessos e não execuções. Um check que corre e falha sempre está tão
 * partido como um que não corre, e a diferença não interessa a quem tem de
 * saber que a plataforma deixou de olhar para um site.
 */
export function summariseLiveness(
  configs: readonly TrackedConfig[],
  successes: readonly LastSuccess[],
  now: Date,
): CheckLiveness[] {
  const ultimo = new Map(successes.map((s) => [`${s.siteId}:${s.checkType}`, s.at]))
  const porTipo = new Map<string, CheckLiveness>()

  for (const config of configs) {
    const sucesso = ultimo.get(`${config.siteId}:${config.checkType}`)
    if (!sucesso) continue

    const atrasoMin = (now.getTime() - sucesso.getTime()) / 60_000
    const atrasado = atrasoMin > lateAfterMinutes(config.intervalMinutes)

    const atual = porTipo.get(config.checkType) ?? {
      checkType: config.checkType,
      tracked: 0,
      late: 0,
      lastSuccessAt: null,
      worstLateMinutes: null,
    }

    atual.tracked++
    if (atrasado) {
      atual.late++
      const arredondado = Math.round(atrasoMin)
      if (atual.worstLateMinutes === null || arredondado > atual.worstLateMinutes) {
        atual.worstLateMinutes = arredondado
      }
    }
    if (atual.lastSuccessAt === null || sucesso > atual.lastSuccessAt) {
      atual.lastSuccessAt = sucesso
    }

    porTipo.set(config.checkType, atual)
  }

  // Os atrasados primeiro, e entre eles o pior à frente: é a ordem por que se
  // lê quando alguma coisa está mal.
  return [...porTipo.values()].sort((a, b) => {
    if (a.late !== b.late) return b.late - a.late
    return (b.worstLateMinutes ?? 0) - (a.worstLateMinutes ?? 0)
  })
}

/** Há quanto tempo deixamos de olhar para trás à procura de sucessos. */
const LOOKBACK_DAYS = 30

/**
 * @param organizationIds Limita aos sites destas organizações. Omitido, olha
 *   para a plataforma inteira — é o que o vigia externo quer saber. O painel
 *   passa as organizações do utilizador: dizer-lhe que o `uptime` está
 *   atrasado em três sites quando ele só tem um é um aviso que ele não
 *   consegue verificar nem resolver.
 */
export async function getCheckLiveness(
  now = new Date(),
  organizationIds?: readonly string[],
): Promise<CheckLiveness[]> {
  const db = getDb()

  // Sem organizações nenhumas não há nada a vigiar — e um `inArray` vazio
  // devolveria a plataforma toda, que é o contrário do pedido.
  if (organizationIds && organizationIds.length === 0) return []

  // Pausados e arquivados não correm nada, e marcá-los como atrasados era
  // inventar uma avaria a partir de uma decisão nossa.
  const configs = await db
    .select({
      siteId: schema.checkConfigs.siteId,
      checkType: schema.checkConfigs.checkType,
      intervalMinutes: schema.checkConfigs.intervalMinutes,
    })
    .from(schema.checkConfigs)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.checkConfigs.siteId))
    .where(
      and(
        eq(schema.checkConfigs.enabled, true),
        notInArray(schema.sites.state, ['paused', 'archived']),
        ...(organizationIds ? [inArray(schema.sites.organizationId, [...organizationIds])] : []),
      ),
    )

  // Sem sucesso há trinta dias já está atrasado de qualquer maneira, e limitar
  // a janela impede a consulta de crescer com o histórico todo.
  const desde = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 3600_000)

  const siteIds = [...new Set(configs.map((config) => config.siteId))]
  if (siteIds.length === 0) return []

  const successes = await db
    .select({
      siteId: schema.checkRuns.siteId,
      checkType: schema.checkRuns.checkType,
      at: sql<string>`max(${schema.checkRuns.startedAt})`,
    })
    .from(schema.checkRuns)
    .where(
      and(
        eq(schema.checkRuns.status, 'ok'),
        gte(schema.checkRuns.startedAt, desde),
        inArray(schema.checkRuns.siteId, siteIds),
      ),
    )
    .groupBy(schema.checkRuns.siteId, schema.checkRuns.checkType)

  return summariseLiveness(
    configs,
    successes.map((row) => ({ ...row, at: new Date(row.at) })),
    now,
  )
}

/* -------------------------------------------------------------------------- */
/* Resumo para a moldura da aplicação                                         */
/* -------------------------------------------------------------------------- */

/** «42 segundos», «7 minutos», «18 horas». Para dizer há quanto tempo. */
export function duracao(segundos: number): string {
  if (segundos < 120) return `${segundos} segundos`
  const minutos = Math.round(segundos / 60)
  if (minutos < 120) return `${minutos} minutos`
  const horas = Math.round(minutos / 60)
  return horas < 48 ? `${horas} horas` : `${Math.round(horas / 24)} dias`
}

export interface ResumoVigia {
  estado: 'ok' | 'alerta'
  titulo: string
  detalhe: string
}

/**
 * Uma linha e meia sobre o vigia, para a barra lateral.
 *
 * A faixa de aviso só aparece quando há avaria; esta pastilha está sempre lá,
 * em todas as páginas. É a diferença entre «não vi nenhum aviso» e «vi que
 * está a vigiar» — e durante dezoito horas a primeira leitura foi a única
 * disponível, com a plataforma parada.
 */
export function resumirVigia(
  health: SchedulerHealth,
  checks: readonly CheckLiveness[],
): ResumoVigia {
  const atrasados = checks.filter((check) => check.late > 0)

  if (health.status === 'stale') {
    return {
      estado: 'alerta',
      titulo: 'Monitorização parada',
      detalhe: `sem passagens há ${duracao(health.ageSeconds ?? 0)}`,
    }
  }

  if (health.status === 'failing') {
    return {
      estado: 'alerta',
      titulo: 'Agendador a falhar',
      detalhe: 'as últimas passagens deram erro',
    }
  }

  if (health.status === 'unknown') {
    return {
      estado: 'alerta',
      titulo: 'Sem sinal do agendador',
      detalhe: 'nunca registou uma passagem',
    }
  }

  if (atrasados.length > 0) {
    return {
      estado: 'alerta',
      titulo:
        atrasados.length === 1
          ? '1 verificação em atraso'
          : `${atrasados.length} verificações em atraso`,
      detalhe: `de ${checks.length} ${checks.length === 1 ? 'tipo' : 'tipos'} vigiados`,
    }
  }

  return {
    estado: 'ok',
    titulo: `A vigiar · há ${duracao(health.ageSeconds ?? 0)}`,
    detalhe:
      checks.length === 0
        ? 'ainda sem verificações concluídas'
        : `${checks.length} ${checks.length === 1 ? 'tipo' : 'tipos'} de verificação · 0 em atraso`,
  }
}
