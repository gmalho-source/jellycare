import { WpUmbrellaClient, type UmbrellaProject } from '@jellycare/connectors'

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
  const token = process.env.WP_UMBRELLA_TOKEN
  if (!token) {
    return {
      projects: [],
      unavailable: 'WP_UMBRELLA_TOKEN não está configurado nesta aplicação.',
    }
  }

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
