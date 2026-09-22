import type { CheckOutcome, ObservedFinding, Site } from '@jellycare/core'
import {
  isOutdated,
  severityFromCvss,
  WP_INVENTORY_CHECK,
  WpUmbrellaClient,
  WpUmbrellaError,
} from '@jellycare/connectors'
import type {
  UmbrellaBackup,
  UmbrellaComponent,
  UmbrellaCore,
  UmbrellaIssue,
  UmbrellaVulnerability,
} from '@jellycare/connectors'
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
  let core: UmbrellaCore
  let vulnerabilities: UmbrellaVulnerability[]
  let backups: UmbrellaBackup[]
  let issues: UmbrellaIssue[]

  try {
    // Sequencial e não em paralelo: a API tem limite de pedidos e não o
    // documenta. Quatro pedidos por site, espaçados, é barato; um pico de
    // paralelismo sobre uma frota inteira não é.
    plugins = await client.listPlugins(projectId)
    themes = await client.listThemes(projectId)
    const relatorio = await client.listVulnerabilities(projectId)
    core = relatorio.core
    vulnerabilities = relatorio.vulnerabilities
    backups = await client.listBackups(projectId)
    // Só os fatais. Os avisos e as depreciações contam-se aos milhares num
    // site normal e não são avaria — transformá-los em findings era encher o
    // painel de vermelho por coisa que não se corrige nem se deve corrigir.
    issues = await client.listIssues(projectId, { severity: 'FATAL' })
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

  await replaceInventory(deps.db, site.id, plugins, themes, core, now)
  await replaceBackups(deps.db, site.id, backups)

  const findings: ObservedFinding[] = vulnerabilities.map(vulnerabilityFinding)

  const desatualizado = coreFinding(core)
  if (desatualizado) findings.push(desatualizado)

  const aviso = backupFinding(backups, now)
  if (aviso) findings.push(aviso)

  findings.push(...phpFatalFindings(issues))

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
      // Separado da contagem de plugins e temas: o core é um só, e somá-lo
      // ao agregado fazia «3 atualizações por aplicar» querer dizer coisas
      // diferentes consoante uma delas fosse o WordPress.
      coreOutdated: isOutdated(core.version, core.latestVersion) ? 1 : 0,
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
  core: UmbrellaCore,
  now: Date,
): Promise<void> {
  // O core entra como um componente de tipo `core`, que é o que o esquema já
  // previa. Uma tabela só para uma linha por site era o mesmo dado escrito
  // noutro sítio, e o painel passava a ter de o ir buscar a dois lados.
  const nucleo: UmbrellaComponent[] =
    core.version === null
      ? []
      : [
          {
            key: 'wordpress',
            name: 'WordPress',
            version: core.version,
            // `newVersion` é, no resto do inventário, «há uma por aplicar».
            // Só a preenchemos quando é mesmo o caso, para o core se ler
            // pelas mesmas regras que tudo o resto.
            newVersion: isOutdated(core.version, core.latestVersion)
              ? core.latestVersion
              : null,
            active: true,
          },
        ]

  const linhas = [
    ...nucleo.map((c) => ({ kind: 'core' as const, component: c })),
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

/**
 * O WordPress desatualizado.
 *
 * Vai à parte do agregado de plugins e temas porque não é a mesma coisa: uma
 * versão do core atrasada é a porta por onde entram as explorações em massa,
 * e as que existem são sempre contra versões conhecidas. Desaparecer dentro
 * de «14 atualizações por aplicar» era enterrar a única que tem alguém à
 * procura dela de forma automática, hoje, em todo o lado.
 *
 * Elevada e não crítica: crítica fica para o que já está a ser explorado
 * neste site, e isso vem das vulnerabilidades com o CVSS delas. Um core
 * atrasado é urgente, não é um incidente em curso.
 */
export function coreFinding(core: UmbrellaCore): ObservedFinding | null {
  if (!isOutdated(core.version, core.latestVersion)) return null

  return {
    code: 'wp_core_outdated',
    discriminator: 'wp_core_outdated',
    severity: 'high',
    title: `WordPress desatualizado (${core.version} → ${core.latestVersion})`,
    detail:
      `O site corre o WordPress ${core.version} e a versão atual é a ${core.latestVersion}. ` +
      'As explorações automáticas procuram versões conhecidas do core em massa, e é por ' +
      'isso que esta atualização não espera pelo mesmo ciclo das outras.',
    evidence: { installed: core.version, latest: core.latestVersion },
  }
}

/**
 * Quantos dias sem cópia de segurança boa antes de isto ser um problema.
 *
 * Sete e não um: uma cópia falhada numa noite é ruído, e o agendamento
 * habitual é diário. Uma semana inteira sem cópia que tenha terminado é
 * outra coisa — é descobrir, no dia em que o site parte, que não há por onde
 * voltar atrás.
 */
export const BACKUP_STALE_DAYS = 7

/**
 * A cópia de segurança é o que nos permite mexer num site sem medo. Vigiá-la
 * é tão parte do serviço como vigiar se o site responde — e é a única das
 * duas coisas que ninguém repara que falhou até precisar dela.
 */
export function backupFinding(
  backups: readonly UmbrellaBackup[],
  now: Date,
): ObservedFinding | null {
  const concluidas = backups
    .filter((backup) => backup.status === 'FINISHED' && backup.finishedAt !== null)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))

  const ultima = concluidas[0]
  const limite = BACKUP_STALE_DAYS * 24 * 3600_000

  if (!ultima) {
    // Nenhuma cópia concluída de que tenhamos notícia. Se nem sequer há
    // tentativas, não afirmamos que falharam — dizemos que não vemos
    // nenhuma, que é o que sabemos.
    return {
      code: 'wp_backup_missing',
      discriminator: 'wp_backup_missing',
      severity: 'high',
      title: 'Sem cópia de segurança concluída',
      detail:
        backups.length === 0
          ? 'Não há registo de nenhuma cópia de segurança deste site.'
          : `Há ${backups.length} ${backups.length === 1 ? 'tentativa registada' : 'tentativas registadas'}, nenhuma concluída com sucesso.`,
      evidence: { attempts: backups.length },
    }
  }

  const idadeMs = now.getTime() - Date.parse(ultima.startedAt)
  if (idadeMs <= limite) return null

  const dias = Math.floor(idadeMs / (24 * 3600_000))
  return {
    code: 'wp_backup_stale',
    discriminator: 'wp_backup_stale',
    severity: 'high',
    title: `Sem cópia de segurança há ${dias} dias`,
    detail:
      `A cópia mais recente que concluiu é de ${ultima.startedAt}. ` +
      'Enquanto isto durar, uma avaria no site não tem por onde ser revertida.',
    evidence: { lastFinishedAt: ultima.startedAt, days: dias },
  }
}

/**
 * Grava as cópias recentes, apagando o que já não vem na resposta.
 *
 * Mesma escolha que o inventário: é um retrato. Uma cópia que saiu da janela
 * de retenção do fornecedor deixou de existir, e mantê-la aqui era prometer
 * um restauro que já não é possível.
 */
async function replaceBackups(
  db: Database,
  siteId: string,
  backups: readonly UmbrellaBackup[],
): Promise<void> {
  const linhas = backups
    .filter((backup) => backup.externalId.length > 0 && !Number.isNaN(Date.parse(backup.startedAt)))
    .map((backup) => ({
      siteId,
      externalId: backup.externalId,
      startedAt: new Date(backup.startedAt),
      finishedAt: backup.finishedAt ? new Date(backup.finishedAt) : null,
      status: backup.status,
      triggerType: backup.triggerType,
      wordpressVersion: backup.wordpressVersion,
      sizeBytes: backup.sizeBytes,
      errorCode: backup.errorCode,
    }))

  await db.transaction(async (tx) => {
    await tx.delete(schema.wpBackups).where(eq(schema.wpBackups.siteId, siteId))
    if (linhas.length > 0) await tx.insert(schema.wpBackups).values(linhas)
  })
}

/**
 * Um finding por origem, e não por erro.
 *
 * Um erro fatal repete-se a cada visita à página afetada: um plugin partido
 * produz milhares de linhas e uma única avaria. Agregar pela origem dá uma
 * entrada por plugin partido, que é o que alguém vai resolver.
 */
export function phpFatalFindings(issues: readonly UmbrellaIssue[]): ObservedFinding[] {
  const fatais = issues.filter((issue) => issue.severity === 'FATAL')
  if (fatais.length === 0) return []

  const porOrigem = new Map<string, UmbrellaIssue[]>()
  for (const issue of fatais) {
    const chave = issue.sourceSlug ?? issue.sourceName ?? issue.file ?? 'desconhecida'
    const lista = porOrigem.get(chave)
    if (lista) lista.push(issue)
    else porOrigem.set(chave, [issue])
  }

  return [...porOrigem.entries()].map(([chave, lista]) => {
    const primeiro = lista[0]!
    const nome = primeiro.sourceName ?? chave
    const ocorrencias = lista.reduce((total, issue) => total + (issue.occurrences ?? 0), 0)

    return {
      code: 'wp_php_fatal',
      discriminator: chave,
      // Um erro fatal não é dívida técnica: é uma página que rebenta a quem
      // lá entra, e pode ser o envio de email que deixou de funcionar.
      severity: 'high' as const,
      title: `Erros fatais de PHP em ${nome}`,
      detail:
        `${lista.length} ${lista.length === 1 ? 'erro fatal distinto' : 'erros fatais distintos'}` +
        (ocorrencias > 0 ? `, ${ocorrencias} ocorrências` : '') +
        `. O mais recente: ${primeiro.message}` +
        (primeiro.file ? ` (${primeiro.file}:${primeiro.line ?? '?'})` : '') +
        '.',
      evidence: {
        source: chave,
        files: [...new Set(lista.map((issue) => issue.file).filter(Boolean))].slice(0, 5),
        occurrences: ocorrencias,
        lastSeenAt: primeiro.lastSeenAt,
      },
    }
  })
}
