import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import type { Severity } from '@jellycare/core'
import { request, type HttpResponse } from './http.js'

export interface ExposedFilesConfig {
  timeoutMs?: number
  /** Caminhos que a equipa confirmou serem intencionais neste site. */
  ignorePaths?: string[]
}

interface ProbeTarget {
  path: string
  code: string
  severity: Severity
  title: string
  detail: string
  /**
   * Confirma que a resposta é mesmo o ficheiro procurado. Sem isto, qualquer
   * site com soft-404 reportaria a lista inteira como exposta.
   */
  matches: (response: HttpResponse) => boolean
}

const looksLikeHtml = (body: string) => /<\s*(html|!doctype)/i.test(body.slice(0, 500))

/**
 * Alvos verificados. Todos são pedidos GET normais a caminhos públicos — não
 * há exploração, nem força bruta, nem tentativa de contornar proteções.
 * Ver docs/riscos.md.
 */
const TARGETS: ProbeTarget[] = [
  {
    path: '/.env',
    code: 'exposed_env',
    severity: 'critical',
    title: 'Ficheiro .env acessível publicamente',
    detail:
      'O .env costuma conter credenciais da base de dados, chaves de API e a chave da aplicação. ' +
      'Deve ser tratado como comprometido: rodar todas as chaves depois de bloquear o acesso.',
    matches: (response) =>
      !looksLikeHtml(response.body) &&
      /^\s*(?:[A-Z][A-Z0-9_]*\s*=|#)/m.test(response.body) &&
      /\b(APP_KEY|DB_PASSWORD|DB_HOST|DB_NAME|SECRET|API_KEY|AWS_)/i.test(response.body),
  },
  {
    path: '/.git/HEAD',
    code: 'exposed_git',
    severity: 'critical',
    title: 'Repositório Git acessível publicamente',
    detail:
      'Com o diretório .git exposto é possível reconstruir o código-fonte completo do site, ' +
      'incluindo credenciais que tenham sido commitadas alguma vez.',
    matches: (response) =>
      /^ref:\s+refs\//.test(response.body.trim()) || /^[0-9a-f]{40}$/.test(response.body.trim()),
  },
  {
    path: '/.git/config',
    code: 'exposed_git_config',
    severity: 'high',
    title: 'Configuração do Git acessível publicamente',
    detail: 'Revela o URL do repositório remoto e, por vezes, credenciais embebidas no remote.',
    matches: (response) => /\[core\]/.test(response.body) && /repositoryformatversion/.test(response.body),
  },
  {
    path: '/wp-config.php.bak',
    code: 'exposed_wp_config_backup',
    severity: 'critical',
    title: 'Cópia de segurança do wp-config.php acessível',
    detail:
      'Um .bak não é interpretado pelo PHP, por isso é servido em texto simples com as ' +
      'credenciais da base de dados à vista.',
    matches: (response) => /DB_PASSWORD|DB_NAME|AUTH_KEY/.test(response.body),
  },
  {
    path: '/phpinfo.php',
    code: 'exposed_phpinfo',
    severity: 'high',
    title: 'phpinfo() acessível publicamente',
    detail:
      'Expõe versões, caminhos absolutos, módulos carregados e variáveis de ambiente — o mapa ' +
      'completo para escolher um exploit.',
    matches: (response) => /phpinfo\(\)|PHP Version/i.test(response.body) && /Configuration File/i.test(response.body),
  },
  {
    path: '/server-status',
    code: 'exposed_server_status',
    severity: 'medium',
    title: 'Apache server-status acessível publicamente',
    detail: 'Revela os URLs pedidos por outros visitantes em tempo real, incluindo query strings.',
    matches: (response) => /Apache Server Status/i.test(response.body),
  },
  {
    path: '/debug.log',
    code: 'exposed_debug_log',
    severity: 'medium',
    title: 'Ficheiro debug.log acessível publicamente',
    detail:
      'Os logs de debug do WordPress contêm caminhos absolutos, queries e por vezes dados ' +
      'pessoais de quem submeteu formulários.',
    matches: (response) =>
      !looksLikeHtml(response.body) && /PHP (Notice|Warning|Fatal error|Deprecated)/i.test(response.body),
  },
  {
    path: '/.DS_Store',
    code: 'exposed_ds_store',
    severity: 'low',
    title: 'Ficheiro .DS_Store acessível publicamente',
    detail: 'Lista os nomes dos ficheiros da pasta, revelando estrutura que deveria ser privada.',
    // Assinatura binária do formato: "Bud1" precedido de um byte nulo.
    matches: (response) => response.body.includes('Bud1'),
  },
  {
    path: '/wp-json/wp/v2/users',
    code: 'wp_user_enumeration',
    severity: 'medium',
    title: 'A API do WordPress permite enumerar utilizadores',
    detail:
      'Os nomes de utilizador ficam públicos, o que reduz um ataque de força bruta a adivinhar ' +
      'apenas a palavra-passe.',
    matches: (response) => {
      if (!response.body.trim().startsWith('[')) return false
      try {
        const parsed: unknown = JSON.parse(response.body)
        return Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null && 'slug' in (parsed[0] as object)
      } catch {
        return false
      }
    },
  },
  {
    path: '/xmlrpc.php',
    code: 'wp_xmlrpc_enabled',
    severity: 'low',
    title: 'xmlrpc.php está ativo',
    detail:
      'É um vetor comum de amplificação de força bruta e de ataques DDoS por pingback. Se o site ' +
      'não usa a app móvel nem Jetpack, pode ser desativado.',
    matches: (response) => /XML-RPC server accepts POST requests only/i.test(response.body),
  },
]

/** Um caminho aleatório que não deve existir, para aprender o comportamento de 404. */
function probePathForBaseline(): string {
  return `/jellycare-baseline-${Math.random().toString(36).slice(2, 12)}`
}

export interface SoftNotFoundBaseline {
  /** O site responde 200 a caminhos inexistentes? */
  softNotFound: boolean
  status: number
  bodyLength: number
  bodySample: string
}

/**
 * Aprende como o site responde a um caminho que de certeza não existe.
 *
 * Muitos WordPress e SPAs devolvem 200 com a homepage ou uma página de erro
 * própria. Sem esta linha de base, um scanner reporta a lista inteira de
 * ficheiros sensíveis como exposta — e perde a confiança do cliente à
 * primeira.
 */
export async function learnBaseline(
  siteUrl: string,
  options: { timeoutMs?: number; fetchImpl?: typeof globalThis.fetch },
): Promise<SoftNotFoundBaseline> {
  const response = await request(new URL(probePathForBaseline(), siteUrl).toString(), {
    timeoutMs: options.timeoutMs ?? 10_000,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })

  return {
    softNotFound: response.status >= 200 && response.status < 300,
    status: response.status,
    bodyLength: response.body.length,
    bodySample: response.body.slice(0, 2000),
  }
}

/**
 * A resposta é distinguível da página de "não existe" do site?
 *
 * Comparar o comprimento com tolerância apanha páginas de erro que variam
 * ligeiramente (o caminho pedido aparece no corpo) sem deixar passar o caso em
 * que o conteúdo é mesmo diferente.
 */
export function differsFromBaseline(
  response: HttpResponse,
  baseline: SoftNotFoundBaseline,
): boolean {
  if (!baseline.softNotFound) return true
  if (response.body === baseline.bodySample) return false

  const ratio =
    baseline.bodyLength === 0
      ? 1
      : Math.abs(response.body.length - baseline.bodyLength) / baseline.bodyLength

  return ratio > 0.1
}

export const exposedFilesCheck: CheckDefinition<ExposedFilesConfig> = {
  type: 'exposed_files',
  defaultIntervalMinutes: 60 * 24,
  confirmationsRequired: 1,

  async run(context: CheckContext, config: ExposedFilesConfig): Promise<CheckResult> {
    const findings: ObservedFinding[] = []
    const ignore = new Set(config.ignorePaths ?? [])
    const fetchOptions = {
      timeoutMs: config.timeoutMs ?? 10_000,
      fetchImpl: context.fetch,
      maxBodyBytes: 64 * 1024,
      ...(context.signal ? { signal: context.signal } : {}),
    }

    const baseline = await learnBaseline(context.site.url, {
      timeoutMs: fetchOptions.timeoutMs,
      fetchImpl: context.fetch,
    })

    const targets = TARGETS.filter((target) => !ignore.has(target.path))

    // Sequencial e não em paralelo: são pedidos ao servidor do cliente e não
    // vale a pena parecer um scanner agressivo por uns segundos a menos.
    for (const target of targets) {
      const url = new URL(target.path, context.site.url).toString()
      let response: HttpResponse
      try {
        response = await request(url, fetchOptions)
      } catch {
        continue
      }

      const accessible = response.status >= 200 && response.status < 300
      if (!accessible) continue
      if (!differsFromBaseline(response, baseline)) continue
      if (!target.matches(response)) continue

      findings.push({
        code: target.code,
        discriminator: target.path,
        severity: target.severity,
        title: target.title,
        detail: target.detail,
        evidence: { url, status: response.status },
      })
    }

    return {
      findings,
      metrics: { pathsProbed: targets.length, softNotFound: baseline.softNotFound ? 1 : 0 },
    }
  },
}
