/**
 * Cliente da API pública da WP Umbrella.
 *
 * Porque é que isto existe em vez de um plugin nosso: a WP Umbrella já tem o
 * plugin instalado nos sites que a Jelly gere, já o mantém e já responde por
 * ele. Escrever o nosso punha um segredo nosso a correr dentro do WordPress de
 * todos os clientes — uma posição de supply chain que não precisamos de
 * ocupar para entregar o que o cliente quer saber.
 *
 * O que tiramos daqui é inventário exato e vulnerabilidades com CVSS. O que
 * continua a ser nosso é tudo o resto: formulários com email canário,
 * corroboração de uptime entre regiões, reputação, TLS, o portal e o
 * relatório. Isto é profundidade em WordPress, não é o produto.
 */

const DEFAULT_BASE_URL = 'https://public-api.wp-umbrella.com'

export interface WpUmbrellaOptions {
  token: string
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof globalThis.fetch
}

/** Um site, como a WP Umbrella lhe chama. */
export interface UmbrellaProject {
  id: number
  name: string
  baseUrl: string
  /** `paired` quando o plugin responde. Qualquer outra coisa é cobertura perdida. */
  connectivity: string | null
  isDisconnected: boolean
  isCurrentlyDown: boolean
  phpIssues: number | null
}

export interface UmbrellaComponent {
  /** `contact-form-7/wp-contact-form-7.php` para plugins, o stylesheet para temas. */
  key: string
  name: string
  version: string | null
  /** Presente só quando há atualização por aplicar. */
  newVersion: string | null
  active: boolean
}

export interface UmbrellaVulnerability {
  /** `plugin`, `theme` ou `wordpress`. */
  kind: 'plugin' | 'theme' | 'wordpress'
  component: string
  installedVersion: string | null
  title: string
  description: string | null
  cvssScore: number | null
  versionFixedIn: string | null
  disclosureDate: string | null
  reference: string | null
}

/**
 * Uma cópia de segurança, tal como o fornecedor a reporta.
 *
 * `finishedAt` é nulo enquanto não termina — e continua nulo quando falha,
 * que é o caso que interessa vigiar.
 */
export interface UmbrellaBackup {
  externalId: string
  startedAt: string
  finishedAt: string | null
  /** `FINISHED`, `ERROR` ou `PENDING`. */
  status: string
  /** `AUTOMATIC` quando saiu do agendamento. */
  triggerType: string | null
  /** A versão do WordPress no momento da cópia. É a única via pela qual a
   *  conhecemos: a API não expõe a versão do core em mais lado nenhum. */
  wordpressVersion: string | null
  sizeBytes: number | null
  errorCode: string | null
}

/**
 * Como se pede a atualização.
 *
 * `SAFE_UPDATE` é o ciclo com cópia de segurança, verificação de saúde e
 * reversão automática. **Não é o comportamento por omissão da API — é um
 * parâmetro**, e é por isso que o enviamos sempre explicitamente. Confiar
 * num default que não controlamos, para uma operação que escreve no site de
 * um cliente, seria confiar em documentação que pode mudar sem nos avisar.
 *
 * `ADVANCED_SAFE_UPDATE` acrescenta validação visual da página depois da
 * atualização. É provavelmente o que queremos para atualizações sem ninguém
 * a olhar, mas não conhecemos o custo nem os limites — fica disponível e não
 * é o que usamos por omissão.
 */
export type UmbrellaUpdateType = 'QUICK_UPDATE' | 'SAFE_UPDATE' | 'ADVANCED_SAFE_UPDATE'

/** O que a API devolve quando se ordena uma atualização. */
export interface UmbrellaProcessRef {
  processId: string
}

/** Uma operação em curso ou terminada do lado da ferramenta. */
export interface UmbrellaProcess {
  id: string
  /** `UPDATE_PLUGIN`, `UPDATE_THEME`, `UPDATE_CORE`, … */
  type: string
  /** `pending`, `finished`, `success` ou `failed`. */
  status: string
  createdAt: string | null
  /** Nome e versão do que foi tocado, quando a API os dá. */
  entityName: string | null
  entityVersion: string | null
}

export class WpUmbrellaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'WpUmbrellaError'
  }
}

/** Um valor que veio de fora e que só se usa se for mesmo do tipo esperado. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : []
}

export class WpUmbrellaClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(private readonly options: WpUmbrellaOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? 20_000
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  /**
   * Um pedido à API.
   *
   * O token nunca entra na mensagem de erro. Já nos aconteceu uma password
   * acabar nos logs por vir dentro de um URL que o `new URL` cuspiu numa
   * exceção, e o custo foi ter de a rodar.
   */
  private async get(path: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          authorization: `Bearer ${this.options.token}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      })
    } catch (error) {
      throw new WpUmbrellaError(
        `Não foi possível contactar a WP Umbrella em ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        0,
      )
    } finally {
      clearTimeout(timer)
    }

    return this.parse(response, path)
  }

  /**
   * O que fazer com uma resposta, seja ela de leitura ou de escrita.
   *
   * Partilhado de propósito: um 429 ou um 401 numa escrita têm de ser lidos
   * exatamente da mesma maneira que numa leitura, e duas cópias desta lógica
   * divergiam na primeira vez que alguém mexesse numa delas.
   */
  private async parse(response: Response, path: string): Promise<unknown> {
    if (response.status === 401 || response.status === 403) {
      throw new WpUmbrellaError(
        'A WP Umbrella recusou as credenciais. Confirme o token e o scope `public_api`.',
        response.status,
      )
    }

    if (response.status === 429) {
      throw new WpUmbrellaError(
        'A WP Umbrella respondeu 429: limite de pedidos atingido.',
        429,
      )
    }

    if (!response.ok) {
      // Um excerto do corpo, porque sem ele um 400 não se diagnostica — foi o
      // que nos custou dias no Safe Browsing.
      const body = (await response.text().catch(() => '')).slice(0, 300)
      throw new WpUmbrellaError(
        `A WP Umbrella respondeu ${response.status} em ${path}: ${body}`,
        response.status,
      )
    }

    return response.json()
  }

  /** A frota inteira. Traz já plugins e temas embutidos, mas sem paginação. */
  async listProjects(): Promise<UmbrellaProject[]> {
    const payload = (await this.get('/projects')) as { data?: unknown }

    return rows(payload?.data).map((row) => {
      const connectivity = row.connectivity as Record<string, unknown> | undefined
      return {
        id: Number(row.id),
        name: str(row.name) ?? str(row.base_url) ?? `Projeto ${String(row.id)}`,
        baseUrl: str(row.base_url) ?? '',
        connectivity: str(connectivity?.status),
        isDisconnected: row.is_disconnected === true,
        isCurrentlyDown: row.is_currently_down === true,
        phpIssues: num(row.count_php_issues),
      }
    })
  }

  /**
   * Plugins de um projeto, com a atualização pendente quando existe.
   *
   * A resposta é paginada. Seguir a paginação até ao fim e não só a primeira
   * página: um site com trinta plugins e o teto em dez faria-nos dizer ao
   * cliente que tem dez, o que é pior do que não dizer nada.
   */
  async listPlugins(projectId: number): Promise<UmbrellaComponent[]> {
    return this.paginate(`/projects/${projectId}/plugins`, (row) => ({
      key: str(row.key) ?? str(row.name) ?? '',
      name: str(row.name) ?? str(row.key) ?? '',
      version: str(row.version),
      newVersion: str((row.need_update as Record<string, unknown> | undefined)?.new_version),
      active: row.is_active === true,
    }))
  }

  /**
   * Temas de um projeto.
   *
   * Os temas não usam a mesma forma que os plugins: trazem `latest_version`
   * em vez de um objeto `need_update`, e há atualização pendente quando essa
   * versão difere da instalada. Mapear os dois da mesma maneira fazia-nos
   * dizer que nenhum tema tem atualizações, sempre.
   */
  async listThemes(projectId: number): Promise<UmbrellaComponent[]> {
    return this.paginate(`/projects/${projectId}/themes`, (row) => {
      const version = str(row.version)
      const latest =
        str(row.latest_version) ??
        str((row.need_update as Record<string, unknown> | undefined)?.new_version)

      return {
        key: str(row.stylesheet) ?? str(row.key) ?? (row.id !== undefined ? String(row.id) : ''),
        name: str(row.name) ?? str(row.stylesheet) ?? '',
        version,
        newVersion: latest && latest !== version ? latest : null,
        active: row.is_active === true,
      }
    })
  }

  /**
   * Um pedido que escreve.
   *
   * Separado do `get` e não um parâmetro dele: quero que qualquer leitura
   * deste ficheiro mostre, numa linha, tudo o que esta plataforma é capaz de
   * alterar no site de um cliente.
   */
  private async post(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      throw new WpUmbrellaError(
        `Não foi possível contactar a WP Umbrella em ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        0,
      )
    } finally {
      clearTimeout(timer)
    }

    return this.parse(response, path)
  }

  /**
   * Ordena a atualização de plugins.
   *
   * As chaves são as mesmas que `listPlugins` devolve — `pasta/ficheiro.php`.
   * Devolve o identificador do processo, que é por onde se sabe depois se
   * correu bem: a chamada volta muito antes de a atualização acabar.
   */
  async updatePlugins(
    projectId: number,
    pluginKeys: readonly string[],
    updateType: UmbrellaUpdateType = 'SAFE_UPDATE',
  ): Promise<UmbrellaProcessRef> {
    const payload = (await this.post(`/projects/${projectId}/plugins/update`, {
      plugin_keys: [...pluginKeys],
      update_type: updateType,
    })) as { data?: Record<string, unknown> }

    const processId = str(payload?.data?.processId)
    if (!processId) {
      throw new WpUmbrellaError(
        'A atualização foi aceite mas não veio identificador de processo; sem ele não há como confirmar o resultado.',
        0,
      )
    }
    return { processId }
  }

  /** O mesmo para temas. A chave é o `stylesheet`. */
  async updateThemes(
    projectId: number,
    themeKeys: readonly string[],
    updateType: UmbrellaUpdateType = 'SAFE_UPDATE',
  ): Promise<UmbrellaProcessRef> {
    const payload = (await this.post(`/projects/${projectId}/themes/update`, {
      theme_keys: [...themeKeys],
      update_type: updateType,
    })) as { data?: Record<string, unknown> }

    const processId = str(payload?.data?.processId)
    if (!processId) {
      throw new WpUmbrellaError(
        'A atualização foi aceite mas não veio identificador de processo; sem ele não há como confirmar o resultado.',
        0,
      )
    }
    return { processId }
  }

  /** As operações de um projeto, para reconciliar o que foi ordenado. */
  async listProcesses(projectId: number, limit = 50): Promise<UmbrellaProcess[]> {
    const payload = (await this.get(
      `/projects/${projectId}/processes?page=1&per_page=${limit}`,
    )) as { data?: unknown }

    return rows(payload?.data).map((row) => {
      const entities = row.entities as Record<string, unknown> | undefined
      return {
        id: str(row.id) ?? '',
        type: (str(row.type) ?? '').toUpperCase(),
        status: (str(row.status) ?? str(row.code) ?? 'unknown').toLowerCase(),
        createdAt: str(row.created_at),
        entityName: str(entities?.name),
        entityVersion: str(entities?.version),
      }
    })
  }

  /**
   * As cópias de segurança recentes.
   *
   * Só a primeira página, e de propósito: o painel mostra o estado recente e
   * não o arquivo todo. Um site com dois anos de cópias diárias traria
   * setecentas linhas por cada recolha, para responder a uma pergunta que se
   * resolve com as últimas trinta.
   */
  async listBackups(projectId: number, limit = 30): Promise<UmbrellaBackup[]> {
    const payload = (await this.get(
      `/projects/${projectId}/backups?page=1&per_page=${limit}`,
    )) as { data?: unknown }

    return rows(payload?.data).map((row) => ({
      externalId: str(row.id) ?? '',
      startedAt: str(row.date) ?? '',
      finishedAt: str(row.date_finished),
      status: (str(row.status) ?? 'UNKNOWN').toUpperCase(),
      triggerType: str(row.trigger_type),
      wordpressVersion: str(row.wordpress_version),
      sizeBytes: num(row.size_bytes),
      errorCode: str(row.error_code),
    }))
  }

  /** Vulnerabilidades conhecidas, da base de dados da Patchstack. */
  async listVulnerabilities(projectId: number): Promise<UmbrellaVulnerability[]> {
    const payload = (await this.get(`/projects/${projectId}/vulnerabilities`)) as {
      data?: Record<string, unknown>
    }
    const data = payload?.data ?? {}
    const out: UmbrellaVulnerability[] = []

    const colher = (
      group: unknown,
      kind: 'plugin' | 'theme',
      componentKey: 'plugin' | 'theme',
    ) => {
      for (const entry of rows(group)) {
        const component = entry[componentKey] as Record<string, unknown> | undefined
        const name = str(component?.name) ?? ''
        for (const vuln of rows(entry.vulnerabilities)) {
          out.push({
            kind,
            component: name,
            installedVersion: str(component?.version),
            title: str(vuln.title) ?? 'Vulnerabilidade sem título',
            description: str(vuln.description),
            cvssScore: num(vuln.cvss_score),
            versionFixedIn: str(vuln.version_fixed_in),
            disclosureDate: str(vuln.disclosure_date),
            reference: str(vuln.patchstack_url),
          })
        }
      }
    }

    colher(data.plugin_vulnerabilities, 'plugin', 'plugin')
    colher(data.theme_vulnerabilities, 'theme', 'theme')

    const core = data.wordpress_vulnerabilities as Record<string, unknown> | undefined
    const coreComponent = core?.wordpress as Record<string, unknown> | undefined
    for (const vuln of rows(core?.vulnerabilities)) {
      out.push({
        kind: 'wordpress',
        component: 'WordPress',
        installedVersion: str(coreComponent?.version),
        title: str(vuln.title) ?? 'Vulnerabilidade sem título',
        description: str(vuln.description),
        cvssScore: num(vuln.cvss_score),
        versionFixedIn: str(vuln.version_fixed_in),
        disclosureDate: str(vuln.disclosure_date),
        reference: str(vuln.patchstack_url),
      })
    }

    return out
  }

  /** Limite de páginas, para um `next` que aponte a si próprio não nos prender. */
  private static readonly MAX_PAGES = 20

  private async paginate<T>(
    path: string,
    map: (row: Record<string, unknown>) => T,
  ): Promise<T[]> {
    const out: T[] = []
    let page = 1

    while (page <= WpUmbrellaClient.MAX_PAGES) {
      const separator = path.includes('?') ? '&' : '?'
      const payload = (await this.get(`${path}${separator}page=${page}&per_page=100`)) as {
        data?: unknown
      }

      const batch = rows(payload?.data)
      out.push(...batch.map(map))

      // Sem `per_page` cheio, não há mais nada para trás. É mais robusto do
      // que confiar nos links de paginação, que no exemplo da especificação
      // apontam `first` e `last` para a mesma página.
      if (batch.length < 100) break
      page++
    }

    return out
  }
}
