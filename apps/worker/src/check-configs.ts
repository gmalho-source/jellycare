import { CHECK_REGISTRY } from '@jellycare/checks'
import { CONNECTOR_CHECKS } from '@jellycare/connectors'
import { FORM_CHECKS } from '@jellycare/forms'
import { schema, type Database } from '@jellycare/db'
import { inArray, notInArray } from 'drizzle-orm'

/**
 * Garantir que todos os sites têm configuração para todas as verificações.
 *
 * As configurações são criadas quando o site é criado, com a lista que
 * existia nesse dia. Uma verificação acrescentada depois nunca chega aos
 * sites antigos: não há linha, o agendador não a vê, e ela simplesmente
 * nunca corre — sem erro, sem aviso, sem nada no painel.
 *
 * Já aconteceu uma vez com o inventário WordPress e só foi descoberto a ler
 * os registos de produção. Isto fecha a origem em vez de remendar o caso: a
 * lista vem dos mesmos registos que o painel e o runner usam, e corre no
 * arranque do worker.
 *
 * Só acrescenta. Uma configuração que alguém desligou à mão fica desligada.
 */
export function allCheckTypes(): { type: string; defaultIntervalMinutes: number }[] {
  return [
    ...Object.values(CHECK_REGISTRY).map((check) => ({
      type: check.definition.type,
      defaultIntervalMinutes: check.definition.defaultIntervalMinutes,
    })),
    ...Object.values(FORM_CHECKS).map((check) => ({
      type: check.type,
      defaultIntervalMinutes: check.defaultIntervalMinutes,
    })),
    ...Object.values(CONNECTOR_CHECKS).map((check) => ({
      type: check.type,
      defaultIntervalMinutes: check.defaultIntervalMinutes,
    })),
  ]
}

export interface BackfillOutcome {
  created: number
}

export async function ensureCheckConfigs(db: Database): Promise<BackfillOutcome> {
  const tipos = allCheckTypes()

  // Sites arquivados ficam de fora: não correm nada, e criar-lhes linhas era
  // encher a tabela para nada.
  const sites = await db
    .select({ id: schema.sites.id })
    .from(schema.sites)
    .where(notInArray(schema.sites.state, ['archived']))

  if (sites.length === 0) return { created: 0 }

  const existentes = await db
    .select({
      siteId: schema.checkConfigs.siteId,
      checkType: schema.checkConfigs.checkType,
    })
    .from(schema.checkConfigs)
    .where(
      inArray(
        schema.checkConfigs.siteId,
        sites.map((site) => site.id),
      ),
    )

  const tem = new Set(existentes.map((linha) => `${linha.siteId}:${linha.checkType}`))

  const novas = sites.flatMap((site) =>
    tipos
      .filter((tipo) => !tem.has(`${site.id}:${tipo.type}`))
      .map((tipo) => ({
        siteId: site.id,
        checkType: tipo.type,
        intervalMinutes: tipo.defaultIntervalMinutes,
        enabled: true,
      })),
  )

  if (novas.length === 0) return { created: 0 }

  await db.insert(schema.checkConfigs).values(novas).onConflictDoNothing()
  return { created: novas.length }
}
