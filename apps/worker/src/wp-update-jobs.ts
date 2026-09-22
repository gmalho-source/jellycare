import type { CheckOutcome, ObservedFinding, Site } from '@jellycare/core'
import { WpUmbrellaClient, WpUmbrellaError } from '@jellycare/connectors'
import { isInAnyMaintenanceWindow, schema, type Database } from '@jellycare/db'
import { and, desc, eq, inArray } from 'drizzle-orm'

/**
 * Aplicar as atualizações sozinho, dentro da janela de manutenção.
 *
 * Esta é a única parte da plataforma que escreve no site de um cliente, e por
 * isso é a que tem mais condições para não correr do que para correr. Por
 * ordem:
 *
 * 1. O site tem de ter a atualização automática ligada, site a site.
 * 2. Tem de estar **dentro** de uma janela de manutenção declarada. A janela
 *    deixou de ser só o silêncio dos alertas: é a autorização para mexer.
 *    Sem janela não corre nada, por muito ligada que a opção esteja.
 * 3. Tem de haver cópia de segurança recente e concluída. Uma atualização
 *    sem cópia é uma aposta, e a reversão do fornecedor não cobre o caso em
 *    que o próprio mecanismo de cópia está partido — que é precisamente o
 *    caso que o nosso finding de cópias existe para apanhar.
 *
 * O que é ordenado fica registado antes de se saber o resultado, porque a
 * chamada volta muito antes de a atualização acabar. A reconciliação é o
 * primeiro passo da execução seguinte.
 */

export interface WpUpdateDeps {
  db: Database
  umbrellaToken?: string | undefined
  /** O instante da execução. O runner passa-o para todos os checks. */
  now?: Date
}

/** Quantos componentes por execução. */
export const MAX_UPDATES_PER_RUN = 5

/** Idade máxima da cópia de segurança para deixar mexer no site. */
export const BACKUP_REQUIRED_WITHIN_DAYS = 7

/** Ao fim disto, um processo que nunca resolveu deixa de ser esperado. */
export const PROCESS_TIMEOUT_HOURS = 12

export async function runWpAutoUpdate(
  deps: WpUpdateDeps,
  site: Site,
  _config: Record<string, unknown>,
): Promise<CheckOutcome> {
  const startedAt = Date.now()
  const now = deps.now ?? new Date()
  const parar = (warning: string): CheckOutcome => ({
    status: 'ok',
    findings: [],
    metrics: { ordered: 0 },
    warnings: [warning],
    durationMs: Date.now() - startedAt,
  })

  const links = await deps.db
    .select()
    .from(schema.connectors)
    .where(
      and(eq(schema.connectors.siteId, site.id), eq(schema.connectors.type, 'wp_umbrella')),
    )
    .limit(1)

  const link = links[0]
  if (!link) return parar('Site sem ligação à ferramenta de manutenção.')
  if (!deps.umbrellaToken) return parar('Sem token configurado nesta aplicação.')

  const projectId = Number(link.externalId)
  if (!Number.isFinite(projectId)) {
    throw new Error(`Identificador de projeto inválido na ligação: ${link.externalId}`)
  }

  const client = new WpUmbrellaClient({ token: deps.umbrellaToken })

  // Antes de ordenar seja o que for: fechar o que ficou por fechar.
  const reconciliados = await reconcilePending(deps.db, client, site.id, projectId, now)

  const rows = await deps.db
    .select({
      autoUpdate: schema.sites.autoUpdate,
      maintenanceWindows: schema.sites.maintenanceWindows,
      maintenanceSchedule: schema.sites.maintenanceSchedule,
    })
    .from(schema.sites)
    .where(eq(schema.sites.id, site.id))
    .limit(1)

  const definicoes = rows[0]
  if (!definicoes?.autoUpdate) {
    return {
      status: 'ok',
      findings: [],
      metrics: { ordered: 0, reconciled: reconciliados },
      warnings: ['Atualização automática desligada neste site.'],
      durationMs: Date.now() - startedAt,
    }
  }

  const janelas = definicoes.maintenanceWindows
  const horario = definicoes.maintenanceSchedule
  if (janelas.length === 0 && !horario) {
    // Ligado e sem janela é a combinação que não faz nada e parece que faz.
    // Dizê-lo em voz alta, porque quem ligou isto espera que aconteça.
    return {
      status: 'ok',
      findings: [
        {
          code: 'wp_auto_update_no_window',
          discriminator: 'wp_auto_update_no_window',
          severity: 'medium',
          title: 'Atualização automática sem janela de manutenção',
          detail:
            'A atualização automática está ligada, mas não há horário de manutenção nem ' +
            'janela declarada — por isso nada é atualizado. Defina um horário para o trabalho ' +
            'poder acontecer.',
          evidence: {},
        },
      ],
      metrics: { ordered: 0, reconciled: reconciliados },
      warnings: [],
      durationMs: Date.now() - startedAt,
    }
  }

  if (!isInAnyMaintenanceWindow(janelas, horario, now)) {
    return {
      status: 'ok',
      findings: [],
      metrics: { ordered: 0, reconciled: reconciliados },
      warnings: ['Fora da janela de manutenção.'],
      durationMs: Date.now() - startedAt,
    }
  }

  const copia = await ultimaCopiaBoa(deps.db, site.id)
  const limite = now.getTime() - BACKUP_REQUIRED_WITHIN_DAYS * 24 * 3600_000
  if (!copia || copia.getTime() < limite) {
    return {
      status: 'ok',
      findings: [
        {
          code: 'wp_auto_update_blocked',
          discriminator: 'wp_auto_update_blocked',
          severity: 'high',
          title: 'Atualizações suspensas por falta de cópia de segurança',
          detail: copia
            ? `A cópia mais recente concluída é de ${copia.toISOString()}, fora do limite de ${BACKUP_REQUIRED_WITHIN_DAYS} dias. Não se atualiza um site que não se consegue reverter.`
            : 'Não há cópia de segurança concluída. Não se atualiza um site que não se consegue reverter.',
          evidence: { lastGoodBackupAt: copia?.toISOString() ?? null },
        },
      ],
      metrics: { ordered: 0, reconciled: reconciliados },
      warnings: [],
      durationMs: Date.now() - startedAt,
    }
  }

  // Ainda há trabalho por fechar da última vez: não se empilha outro lote por
  // cima, senão perde-se a correspondência entre o que se mandou e o que
  // aconteceu.
  const pendentes = await deps.db
    .select({ id: schema.wpUpdates.id })
    .from(schema.wpUpdates)
    .where(and(eq(schema.wpUpdates.siteId, site.id), eq(schema.wpUpdates.status, 'pending')))
    .limit(1)
  if (pendentes.length > 0) {
    return {
      status: 'ok',
      findings: [],
      metrics: { ordered: 0, reconciled: reconciliados },
      warnings: ['Há atualizações ainda por confirmar; nada de novo foi ordenado.'],
      durationMs: Date.now() - startedAt,
    }
  }

  const candidatos = await porAtualizar(deps.db, site.id)
  if (candidatos.length === 0) {
    return {
      status: 'ok',
      findings: [],
      metrics: { ordered: 0, reconciled: reconciliados },
      warnings: [],
      durationMs: Date.now() - startedAt,
    }
  }

  const lote = candidatos.slice(0, MAX_UPDATES_PER_RUN)
  const plugins = lote.filter((c) => c.kind === 'plugin')
  const temas = lote.filter((c) => c.kind === 'theme')

  const findings: ObservedFinding[] = []
  const warnings: string[] = []
  let ordenados = 0

  try {
    if (plugins.length > 0) {
      const { processId } = await client.updatePlugins(
        projectId,
        plugins.map((c) => c.key),
      )
      await registar(deps.db, site.id, plugins, processId, now)
      ordenados += plugins.length
    }
    if (temas.length > 0) {
      const { processId } = await client.updateThemes(
        projectId,
        temas.map((c) => c.key),
      )
      await registar(deps.db, site.id, temas, processId, now)
      ordenados += temas.length
    }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    if (error instanceof WpUmbrellaError && error.status === 429) {
      return {
        status: 'ok',
        findings: [],
        metrics: { ordered: ordenados, reconciled: reconciliados },
        warnings: [mensagem],
        durationMs: Date.now() - startedAt,
      }
    }
    throw error
  }

  return {
    status: 'ok',
    findings,
    metrics: { ordered: ordenados, reconciled: reconciliados, candidates: candidatos.length },
    warnings,
    durationMs: Date.now() - startedAt,
  }
}

/** A data da cópia concluída mais recente. */
async function ultimaCopiaBoa(db: Database, siteId: string): Promise<Date | null> {
  const linhas = await db
    .select({ startedAt: schema.wpBackups.startedAt })
    .from(schema.wpBackups)
    .where(and(eq(schema.wpBackups.siteId, siteId), eq(schema.wpBackups.status, 'FINISHED')))
    .orderBy(desc(schema.wpBackups.startedAt))
    .limit(1)

  return linhas[0]?.startedAt ?? null
}

export interface Candidato {
  kind: 'plugin' | 'theme'
  key: string
  name: string
  version: string | null
  latestVersion: string | null
  vulnerable: boolean
}

/**
 * O que há para atualizar, com o que tem vulnerabilidade conhecida primeiro.
 *
 * A ordem importa porque o lote é limitado: se só couberem cinco, que sejam
 * os cinco que estão a expor o site, e não os cinco primeiros por ordem
 * alfabética.
 */
async function porAtualizar(db: Database, siteId: string): Promise<Candidato[]> {
  const componentes = await db
    .select()
    .from(schema.wpComponents)
    .where(eq(schema.wpComponents.siteId, siteId))

  const vulneraveis = await db
    .select({ discriminator: schema.findings.discriminator })
    .from(schema.findings)
    .where(
      and(
        eq(schema.findings.siteId, siteId),
        eq(schema.findings.code, 'wp_known_vulnerability'),
        inArray(schema.findings.state, ['open', 'acknowledged']),
      ),
    )

  const nomesVulneraveis = new Set(
    vulneraveis
      .map((linha) => (linha.discriminator ?? '').toLowerCase())
      .filter((valor) => valor.length > 0),
  )

  const temVulnerabilidade = (nome: string) => {
    const alvo = nome.toLowerCase()
    for (const discriminador of nomesVulneraveis) {
      if (discriminador.includes(alvo)) return true
    }
    return false
  }

  return componentes
    .filter(
      (componente) =>
        componente.latestVersion !== null &&
        componente.latestVersion !== componente.version &&
        (componente.kind === 'plugin' || componente.kind === 'theme') &&
        componente.key.length > 0,
    )
    .map((componente) => ({
      kind: componente.kind as 'plugin' | 'theme',
      key: componente.key,
      name: componente.name,
      version: componente.version,
      latestVersion: componente.latestVersion,
      vulnerable: temVulnerabilidade(componente.name),
    }))
    .sort((a, b) => {
      if (a.vulnerable !== b.vulnerable) return a.vulnerable ? -1 : 1
      return a.name.localeCompare(b.name, 'pt')
    })
}

async function registar(
  db: Database,
  siteId: string,
  componentes: readonly Candidato[],
  processId: string,
  now: Date,
): Promise<void> {
  await db.insert(schema.wpUpdates).values(
    componentes.map((componente) => ({
      siteId,
      kind: componente.kind,
      key: componente.key,
      name: componente.name,
      fromVersion: componente.version,
      toVersion: componente.latestVersion,
      vulnerable: componente.vulnerable,
      processId,
      status: 'pending' as const,
      orderedAt: now,
    })),
  )
}

/**
 * Fechar o que ficou aberto.
 *
 * A ferramenta devolve o processo muito antes de a atualização acabar, por
 * isso o resultado só se sabe depois. Um processo que nunca aparece e nunca
 * resolve fica `unknown` ao fim de meio dia — dizer que correu bem seria
 * inventar, e deixá-lo pendente para sempre bloqueava todas as atualizações
 * seguintes deste site.
 */
export async function reconcilePending(
  db: Database,
  client: Pick<WpUmbrellaClient, 'listProcesses'>,
  siteId: string,
  projectId: number,
  now: Date,
): Promise<number> {
  const pendentes = await db
    .select()
    .from(schema.wpUpdates)
    .where(and(eq(schema.wpUpdates.siteId, siteId), eq(schema.wpUpdates.status, 'pending')))

  if (pendentes.length === 0) return 0

  let processos: Awaited<ReturnType<WpUmbrellaClient['listProcesses']>> = []
  try {
    processos = await client.listProcesses(projectId)
  } catch {
    // Não conseguir ler agora não é motivo para concluir nada.
    return 0
  }

  const porId = new Map(processos.map((processo) => [processo.id, processo]))
  const limite = now.getTime() - PROCESS_TIMEOUT_HOURS * 3600_000
  let fechados = 0

  for (const linha of pendentes) {
    const processo = porId.get(linha.processId)
    const estado = processo?.status

    let novo: 'succeeded' | 'failed' | 'unknown' | null = null
    if (estado === 'failed') novo = 'failed'
    else if (estado === 'finished' || estado === 'success') novo = 'succeeded'
    else if (!processo && linha.orderedAt.getTime() < limite) novo = 'unknown'

    if (!novo) continue

    await db
      .update(schema.wpUpdates)
      .set({
        status: novo,
        settledAt: now,
        error:
          novo === 'unknown'
            ? 'A ferramenta deixou de reportar este processo antes de ele concluir.'
            : null,
      })
      .where(eq(schema.wpUpdates.id, linha.id))
    fechados++
  }

  return fechados
}
