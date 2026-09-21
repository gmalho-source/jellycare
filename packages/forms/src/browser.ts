import { chromium, type Browser, type LaunchOptions } from 'playwright'

export interface BrowserOptions {
  /**
   * Caminho para o Chromium. Em imagens que já trazem o browser instalado
   * (containers de CI, o runner do worker), evita descarregá-lo outra vez e
   * evita o desencontro entre a versão do Playwright e a do binário.
   */
  executablePath?: string
  headless?: boolean
  /** Necessário em containers sem user namespaces. */
  noSandbox?: boolean
}

export function resolveExecutablePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.JELLYCARE_CHROMIUM_PATH || undefined
}

/**
 * Abre um Chromium para a submissão de formulários.
 *
 * O worker reutiliza uma instância entre submissões: arrancar um browser por
 * formulário custa segundos e memória que não temos de gastar.
 */
export async function launchBrowser(options: BrowserOptions = {}): Promise<Browser> {
  const executablePath = options.executablePath ?? resolveExecutablePath()

  const launchOptions: LaunchOptions = {
    headless: options.headless ?? true,
  }
  if (executablePath) launchOptions.executablePath = executablePath
  if (options.noSandbox ?? process.env.JELLYCARE_CHROMIUM_NO_SANDBOX === '1') {
    launchOptions.args = ['--no-sandbox', '--disable-dev-shm-usage']
  }

  return chromium.launch(launchOptions)
}
