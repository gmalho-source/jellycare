import type { CheckOutcome, ObservedFinding, Site } from '@jellycare/core'
import {
  severityFromCvss,
  WP_INVENTORY_CHECK,
  WpUmbrellaClient,
  WpUmbrellaError,
} from '@jellycare/connectors'
import type { UmbrellaComponent, UmbrellaVulnerability } from '@jellycare/connectors'
import { schema, type Database } from '@jellycare/db'
import { and, eq } from 'drizzle-orm'

/**
 * Profundidade em WordPress, pela API da WP Umbrella.
 *
 * Tudo o resto no Jellycare observa o site de fora. Isto é a exceção: lê o
 * inventário exato de dentro, através de uma ferramenta que já lá está
 * instalada. O que ganhamos é deixar de adivinhar — "provavelmente tens o
 * plugin X na versão Y" passa a "tens", e as vulnerabilidades passam a vir
 * com CVSS e referência em vez de um palpite por fingerprint.
 */

export { WP_INVENTORY_CHECK }

export interface WpJobDeps {
  db: Database
  /** Token da conta Jelly na WP Umbrella. Sem ele o check não corre. */
  umbrellaToken?: string
  umbrellaBaseUrl?: string
  fetch?: typeof globalThis.fetch
  now?: Date
}

export interface WpInventoryConfig {
  timeoutMs?: number
}

/** Quantos componentes desatualizados chegam para valer um finding. */
const UPDATE_FINDING_THRESHOLD = 1

function outdated(components: readonly UmbrellaComponent[]): UmbrellaComponent[] {
  return components.filter((component) => component.newVersion !== null)
}

/**
 * O finding de uma vulnerabilidade concreta.
 *
 * Um por vulnerabilidade e não um agregado: são coisas diferentes, com
 * severidades diferentes e prazos diferentes, e agregá-las fazia um crítico
 * desaparecer dentro de uma contagem.
 */
function vulnerabilityFinding(vuln: UmbrellaVulnerability): ObservedFinding {
  const severity = severityFromCvss(vuln.cvssScore)
  const alvo = vuln.kind === 'wordpress' ? 'o WordPress' : `o ${vuln.kind === 'plugin' ? 'plugin' : 'tema'} "${vuln.component}"`

  const correcao = vuln.versionFixedIn
    ? `Corrigido na versão ${vuln.versionFixedIn}.`
    : 'Ainda não há versão que corrija.'

  return {
    code: 'wp_known_vulnerability',
    // A versão instalada entra no discriminador de propósito: atualizar para
    // uma versão que continua vulnerável é um problema novo, e não o mesmo.
    discriminator: `${vuln.kind}:${vuln.component}:${vuln.installedVersion ?? '?'}:${vuln.title}`,
    severity,
    title: `Vulnerabilidade conhecida em ${vuln.component}`,
    detail:
      `${vuln.title}. Afeta ${alvo}${
        vuln.installedVersion ? `, na versão ${vuln.installedVersion} que está instalada` : ''
      }. ${correcao}` +
      (vuln.cvssScore !== null ? ` Gravidade CVSS ${vuln.cvssScore}.` : ''),
    evidence: {
      kind: vuln.kind,
      component: vuln.component,
      installedVersion: vuln.installedVersion,
      cvssScore: vuln.cvssScore,
      versionFixedIn: vuln.versionFixedIn,
      disclosureDate: vuln.disclosureDate,
      reference: vuln.reference,
    },
  }
}

/**
 * Sincroniza o inventário de um site WordPress e transforma-o em findings.
 *
 * O site tem de estar ligado a um projeto da WP Umbrella no painel. A ligação
 * não é automática por hostname de propósito: ligar o site errado faz-nos
 * reportar as vulnerabilidades de um cliente a outro, o que é pior do que não
 * reportar nada.
 */
export async function runWpInventory(
  deps: WpJobDeps,
  site: Site,
  config: WpInventoryConfig,
): Promise<CheckOutcome> {
  const startedAt = Date.now()
  const now = deps.now ?? new Date()

  const links = await deps.db
    .select()
    .from(schema.connectors)
    .where(and(eq(schema.connectors.siteId, site.id), eq(schema.connectors.type, 'wp_umbrella')))
    .limit(1)

  const link = links[0]
  if (!link) {
    // Não é erro: a maioria dos sites não é WordPress, e um site WordPress
    // que ainda não foi ligado está à espera de configuração, não avariado.
    return {
      status: 'ok',
      findings: [],
      metrics: {},
      warnings: ['Site não está ligado a nenhum projeto da WP Umbrella.'],
      durationMs: Date.now() - startedAt,
    }
  }

  if (!deps.umbrellaToken) {
    throw new Error('WP_UMBRELLA_TOKEN não está definido: o inventário WordPress precisa dele.')
  }

  const client = new WpUmbrellaClient({
    token: deps.umbrellaToken,
    ...(deps.umbrellaBaseUrl ? { baseUrl: deps.umbrellaBaseUrl } : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(deps.fetch ? { fetchImpl: deps.fetch } : {}),
  })

  const projectId = Number(link.externalId)
  if (!Number.isFinite(projectId)) {
    throw new Error(`Identificador de projeto inválido na ligação: ${link.externalId}`)
  }

  let plugins: UmbrellaComponent[]
  let themes: UmbrellaComponent[]
  let vulnerabilities: UmbrellaVulnerability[]

  try {
    // Sequencial e não em paralelo: a API tem limite de pedidos e não o
    // documenta. Três pedidos por site, espaçados, é barato; um pico de
    // paralelismo sobre uma frota inteira não é.
    plugins = await client.listPlugins(projectId)
    themes = await client.listThemes(projectId)
    vulnerabilities = await client.listVulnerabilities(projectId)
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    await deps.db
      .update(schema.connectors)
      .set({ lastError: mensagem })
      .where(eq(schema.connectors.id, link.id))

    // Um 429 não é avaria nossa nem do cliente: é ritmo. Volta a correr no
    // próximo ciclo e não deve marcar o run como falhado.
    if (error instanceof WpUmbrellaError && error.status === 429) {
      return {
        status: 'ok',
        findings: [],
        metrics: {},
        warnings: [mensagem],
        durationMs: Date.now() - startedAt,
      }
    }
    throw error
  }

  await replaceInventory(deps.db, site.id, plugins, themes, now)

  const findings: ObservedFinding[] = vulnerabilities.map(vulnerabilityFinding)

  const pluginsPorAtualizar = outdated(plugins)
  const temasPorAtualizar = outdated(themes)
  const total = pluginsPorAtualizar.length + temasPorAtualizar.length

  if (total >= UPDATE_FINDING_THRESHOLD) {
    // Um agregado, e não um finding por componente: uma lista de vinte
    // alertas "há update" ensina o cliente a ignorar alertas. As
    // vulnerabilidades é que vão uma a uma, porque essas exigem decisão.
    const nomes = [...pluginsPorAtualizar, ...temasPorAtualizar]
      .map((c) => `${c.name} ${c.version ?? '?'} → ${c.newVersion}`)
      .slice(0, 12)

    findings.push({
      code: 'wp_updates_pending',
      discriminator: 'wp_updates_pending',
      // Média e não elevada: estar desatualizado é dívida, não incidente. O
      // que é incidente são as vulnerabilidades, e essas já vão à parte com a
      // severidade que o CVSS lhes dá.
      severity: 'medium',
      title:
        total === 1
          ? 'Uma atualização por aplicar'
          : `${total} atualizações por aplicar`,
      detail:
        `${pluginsPorAtualizar.length} ${pluginsPorAtualizar.length === 1 ? 'plugin' : 'plugins'} e ` +
        `${temasPorAtualizar.length} ${temasPorAtualizar.length === 1 ? 'tema' : 'temas'} têm versão mais recente disponível. ` +
        nomes.join('; ') +
        (total > nomes.length ? `; e mais ${total - nomes.length}.` : '.'),
      evidence: {
        plugins: pluginsPorAtualizar.map((c) => ({ key: c.key, from: c.version, to: c.newVersion })),
        themes: temasPorAtualizar.map((c) => ({ key: c.key, from: c.version, to: c.newVersion })),
      },
    })
  }

  await deps.db
    .update(schema.connectors)
    .set({ lastSyncAt: now, lastError: null })
    .where(eq(schema.connectors.id, link.id))

  return {
    status: 'ok',
    findings,
    metrics: {
      plugins: plugins.length,
      themes: themes.length,
      updatesPending: total,
      vulnerabilities: vulnerabilities.length,
    },
    durationMs: Date.now() - startedAt,
  }
}

/**
 * Grava o retrato atual, apagando o anterior.
 *
 * Um plugin desinstalado tem de desaparecer da lista. Se ficasse lá, o painel
 * mostrava ao cliente que tem um plugin que já não tem — e, pior, podíamos
 * continuar a reportar uma vulnerabilidade de um plugin que já foi removido.
 */
async function replaceInventory(
  db: Database,
  siteId: string,
  plugins: readonly UmbrellaComponent[],
  themes: readonly UmbrellaComponent[],
  now: Date,
): Promise<void> {
  const linhas = [
    ...plugins.map((c) => ({ kind: 'plugin' as const, component: c })),
    ...themes.map((c) => ({ kind: 'theme' as const, component: c })),
  ]
    .filter(({ component }) => component.key.length > 0)
    .map(({ kind, component }) => ({
      siteId,
      kind,
      key: component.key,
      name: component.name,
      version: component.version,
      latestVersion: component.newVersion,
      active: component.active,
      observedAt: now,
    }))

  await db.transaction(async (tx) => {
    await tx.delete(schema.wpComponents).where(eq(schema.wpComponents.siteId, siteId))
    if (linhas.length > 0) await tx.insert(schema.wpComponents).values(linhas)
  })
}
