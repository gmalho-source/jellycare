import { schema } from '@jellycare/db'
import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { getDb } from './db'

export interface NotaDoRelatorio {
  id: string
  body: string
  mode: 'persistent' | 'next_only'
  createdAt: Date
  createdByEmail: string | null
  archivedAt: Date | null
  /** O relatório que levou uma nota «só no próximo», quando já seguiu. */
  enviadaEm: { periodYear: number; periodMonth: number } | null
}

const COLUNAS = {
  id: schema.reportNotes.id,
  body: schema.reportNotes.body,
  mode: schema.reportNotes.mode,
  createdAt: schema.reportNotes.createdAt,
  createdByEmail: schema.users.email,
  archivedAt: schema.reportNotes.archivedAt,
  periodYear: schema.reports.periodYear,
  periodMonth: schema.reports.periodMonth,
}

function paraNota(linha: {
  id: string
  body: string
  mode: 'persistent' | 'next_only'
  createdAt: Date
  createdByEmail: string | null
  archivedAt: Date | null
  periodYear: number | null
  periodMonth: number | null
}): NotaDoRelatorio {
  const { periodYear, periodMonth, ...nota } = linha
  return {
    ...nota,
    enviadaEm:
      periodYear !== null && periodMonth !== null ? { periodYear, periodMonth } : null,
  }
}

/**
 * As notas da equipa de um site, separadas pelo que vai acontecer a cada uma.
 *
 * `ativas` é exatamente o que o worker vai buscar para o próximo relatório —
 * as mesmas condições, para o painel nunca mostrar como pendente uma nota que
 * o relatório não leva, ou esconder uma que leva.
 *
 * `anteriores` é o que já foi dito ao cliente ou foi retirado. Fica à vista
 * porque é a primeira pergunta de quem vai escrever uma nota nova: isto já
 * lhe foi dito?
 */
export async function lerNotasDoRelatorio(
  siteId: string,
): Promise<{ ativas: NotaDoRelatorio[]; anteriores: NotaDoRelatorio[] }> {
  const db = getDb()
  const base = () =>
    db
      .select(COLUNAS)
      .from(schema.reportNotes)
      .leftJoin(schema.users, eq(schema.users.id, schema.reportNotes.createdBy))
      .leftJoin(schema.reports, eq(schema.reports.id, schema.reportNotes.reportId))

  const [ativas, anteriores] = await Promise.all([
    base()
      .where(
        and(
          eq(schema.reportNotes.siteId, siteId),
          isNull(schema.reportNotes.archivedAt),
          or(
            eq(schema.reportNotes.mode, 'persistent'),
            and(eq(schema.reportNotes.mode, 'next_only'), isNull(schema.reportNotes.reportId)),
          ),
        ),
      )
      .orderBy(schema.reportNotes.createdAt),
    base()
      .where(
        and(
          eq(schema.reportNotes.siteId, siteId),
          or(
            isNotNull(schema.reportNotes.archivedAt),
            and(eq(schema.reportNotes.mode, 'next_only'), isNotNull(schema.reportNotes.reportId)),
          ),
        ),
      )
      .orderBy(desc(schema.reportNotes.createdAt))
      .limit(10),
  ])

  return { ativas: ativas.map(paraNota), anteriores: anteriores.map(paraNota) }
}
