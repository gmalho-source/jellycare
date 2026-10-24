import { WpUmbrellaClient, type UmbrellaProject } from '@jellycare/connectors'

/** Hostname sem `www.`, para comparar o site com o projeto da WP Umbrella. */
function hostSemWww(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
}

/**
 * O projeto é deste site?
 *
 * Igualdade de hostname, sem `www.`. `blog.cliente.pt` não é `cliente.pt`:
 * um subdomínio é muitas vezes outro sistema, e ligá-lo fazia o inventário
 * e as atualizações de um projeto caírem no site errado.
 */
export function projectMatchesHostname(baseUrl: string, hostname: string): boolean {
  const site = hostSemWww(hostname)
  if (!site) return false
  try {
    const withScheme = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`
    return hostSemWww(new URL(withScheme).hostname) === site
  } catch {
    return false
  }
}

export function projectsForHostname(
  projects: readonly UmbrellaProject[],
  hostname: string,
): UmbrellaProject[] {
  return projects.filter((project) => projectMatchesHostname(project.baseUrl, hostname))
}

/** Porque é que a lista não pode ser pedida, quando a causa é a configuração. */
export function umbrellaNotConfiguredReason(): string | undefined {
  if (process.env.WP_UMBRELLA_TOKEN) return undefined
  return 'WP_UMBRELLA_TOKEN não está configurado nesta aplicação.'
}

/**
 * A lista de projetos da WP Umbrella, para o painel oferecer a escolha.
 *
 * Só do lado do servidor. O token é da conta da Jelly e nunca sai daqui para
 * o browser — o que chega ao componente cliente é a lista já resolvida.
 */
export interface UmbrellaProjects {
  projects: UmbrellaProject[]
  /** Porque é que a lista veio vazia, quando veio. */
  unavailable?: string
}

export async function listUmbrellaProjects(): Promise<UmbrellaProjects> {
  const missing = umbrellaNotConfiguredReason()
  if (missing || !process.env.WP_UMBRELLA_TOKEN) {
    return { projects: [], unavailable: missing }
  }
  const token = process.env.WP_UMBRELLA_TOKEN

  try {
    const client = new WpUmbrellaClient({ token, timeoutMs: 10_000 })
    return { projects: await client.listProjects() }
  } catch (error) {
    // A página do site não pode ir abaixo porque a API de um terceiro está em
    // baixo. O painel diz o que se passa e o resto da página continua a
    // funcionar.
    return {
      projects: [],
      unavailable: error instanceof Error ? error.message : String(error),
    }
  }
}
