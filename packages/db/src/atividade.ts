import {
  atividadeInterna,
  TIPOS_DE_ATIVIDADE,
  type DadosDaAtividade,
  type TipoDeAtividade,
} from '@jellycare/core'
import { and, count, desc, eq, gte, inArray, lt, notInArray, type SQL } from 'drizzle-orm'
import type { Database } from './client.js'
import { activityEvents, sites, users } from './schema.js'

/** Uma linha nova do registo. */
export interface NovaAtividade {
  siteId: string
  tipo: TipoDeAtividade
  dados: DadosDaAtividade
  findingId?: string | null
  /** Nulo: foi o próprio Jellycare. */
  actorId?: string | null
  quando?: Date
}

/** Quem pode escrever: a base de dados ou uma transação aberta nela. */
type Escritor = Pick<Database, 'insert'>

/**
 * Acrescenta ao registo.
 *
 * Quem chama decide se isto vai na mesma transação da mudança que regista. Na
 * reconciliação dos problemas vai: um problema resolvido sem linha no registo
 * seria um buraco no histórico. Numa ação da equipa já feita, o registo vem
 * depois, e uma falha aqui não desfaz o que a pessoa fez.
 */
export async function registarAtividade(db: Escritor, eventos: NovaAtividade | NovaAtividade[]): Promise<void> {
  const lista = Array.isArray(eventos) ? eventos : [eventos]
  if (lista.length === 0) return
  await db.insert(activityEvents).values(
    lista.map((evento) => ({
      siteId: evento.siteId,
      findingId: evento.findingId ?? null,
      kind: evento.tipo,
      actorId: evento.actorId ?? null,
      data: evento.dados as Record<string, unknown>,
      ...(evento.quando ? { occurredAt: evento.quando } : {}),
    })),
  )
}

/** Versão tolerante, para depois de uma ação já feita: regista o erro e segue. */
export async function registarAtividadeSemFalhar(db: Escritor, eventos: NovaAtividade | NovaAtividade[]): Promise<void> {
  try {
    await registarAtividade(db, eventos)
  } catch (erro) {
    console.error('Falha ao escrever no registo de atividade', erro instanceof Error ? erro.message : erro)
  }
}

export interface FiltroDeAtividade {
  /** Restringe a estes sites. Vazio quer dizer nenhum. */
  siteIds?: string[]
  tipos?: TipoDeAtividade[]
  desde?: Date
  ate?: Date
  /** Os tipos só da equipa. O cliente nunca os vê. */
  incluirInternos: boolean
  limite?: number
}

export interface LinhaDeAtividade {
  id: string
  siteId: string
  siteLabel: string
  findingId: string | null
  tipo: TipoDeAtividade
  dados: DadosDaAtividade
  quando: Date
  /** Nulo: o próprio Jellycare. */
  autor: { nome: string | null; email: string } | null
}

const TIPOS_INTERNOS = TIPOS_DE_ATIVIDADE.filter(atividadeInterna)

function condicoesDe(filtro: FiltroDeAtividade): SQL[] | null {
  if (filtro.siteIds && filtro.siteIds.length === 0) return null
  if (filtro.tipos && filtro.tipos.length === 0) return null

  const condicoes: SQL[] = []
  if (filtro.siteIds) condicoes.push(inArray(activityEvents.siteId, filtro.siteIds))
  if (filtro.tipos) condicoes.push(inArray(activityEvents.kind, filtro.tipos))
  if (!filtro.incluirInternos) condicoes.push(notInArray(activityEvents.kind, TIPOS_INTERNOS))
  if (filtro.desde) condicoes.push(gte(activityEvents.occurredAt, filtro.desde))
  if (filtro.ate) condicoes.push(lt(activityEvents.occurredAt, filtro.ate))
  return condicoes
}

/**
 * Quantas linhas de cada tipo, no período inteiro.
 *
 * À parte da lista porque a lista tem limite e o resumo não pode ter: «32
 * resolvidos» tem de ser 32 mesmo quando só se mostram as últimas duzentas
 * entradas.
 */
export async function contarAtividade(
  db: Database,
  filtro: Omit<FiltroDeAtividade, 'limite'>,
): Promise<Partial<Record<TipoDeAtividade, number>>> {
  const condicoes = condicoesDe(filtro)
  if (!condicoes) return {}
  const linhas = await db
    .select({ kind: activityEvents.kind, total: count() })
    .from(activityEvents)
    .where(condicoes.length > 0 ? and(...condicoes) : undefined)
    .groupBy(activityEvents.kind)
  const contagem: Partial<Record<TipoDeAtividade, number>> = {}
  for (const linha of linhas) {
    if ((TIPOS_DE_ATIVIDADE as readonly string[]).includes(linha.kind)) {
      contagem[linha.kind as TipoDeAtividade] = Number(linha.total)
    }
  }
  return contagem
}

/** O registo, do mais recente para o mais antigo. */
export async function lerAtividade(db: Database, filtro: FiltroDeAtividade): Promise<LinhaDeAtividade[]> {
  const condicoes = condicoesDe(filtro)
  if (!condicoes) return []

  const linhas = await db
    .select({
      id: activityEvents.id,
      siteId: activityEvents.siteId,
      siteLabel: sites.label,
      findingId: activityEvents.findingId,
      kind: activityEvents.kind,
      data: activityEvents.data,
      occurredAt: activityEvents.occurredAt,
      autorNome: users.name,
      autorEmail: users.email,
    })
    .from(activityEvents)
    .innerJoin(sites, eq(sites.id, activityEvents.siteId))
    .leftJoin(users, eq(users.id, activityEvents.actorId))
    .where(condicoes.length > 0 ? and(...condicoes) : undefined)
    .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id))
    .limit(filtro.limite ?? 200)

  return linhas
    .filter((linha) => (TIPOS_DE_ATIVIDADE as readonly string[]).includes(linha.kind))
    .map((linha) => ({
      id: linha.id,
      siteId: linha.siteId,
      siteLabel: linha.siteLabel,
      findingId: linha.findingId,
      tipo: linha.kind as TipoDeAtividade,
      dados: linha.data as DadosDaAtividade,
      quando: linha.occurredAt,
      autor: linha.autorEmail ? { nome: linha.autorNome, email: linha.autorEmail } : null,
    }))
}
