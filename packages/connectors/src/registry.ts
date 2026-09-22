/**
 * Verificações que dependem de um conector externo.
 *
 * Tal como as de formulários, não são `CheckDefinition`: escrevem na base de
 * dados e falam com um serviço de terceiros. Ficam aqui só os metadados de
 * que o agendador e o painel precisam.
 */
export interface ConnectorCheckMeta {
  type: string
  label: string
  access: 'verified'
  defaultIntervalMinutes: number
  confirmationsRequired: number
}

export const WP_INVENTORY_CHECK = 'wp_inventory'

export const WP_AUTO_UPDATE_CHECK = 'wp_auto_update'

export const CONNECTOR_CHECKS: Record<string, ConnectorCheckMeta> = {
  [WP_INVENTORY_CHECK]: {
    type: WP_INVENTORY_CHECK,
    label: 'Inventário e vulnerabilidades WordPress',
    access: 'verified',
    // Diário. O inventário muda pouco, mas uma CVE nova pode sair a qualquer
    // hora e o que nos interessa é o intervalo entre ela existir e nós
    // sabermos — não entre o cliente instalar um plugin e nós darmos conta.
    defaultIntervalMinutes: 60 * 24,
    confirmationsRequired: 1,
  },
  [WP_AUTO_UPDATE_CHECK]: {
    type: WP_AUTO_UPDATE_CHECK,
    label: 'Atualizações automáticas WordPress',
    access: 'verified',
    // De hora a hora. Não é a frequência com que se atualiza — é a
    // frequência com que se pergunta «estamos dentro da janela?». Uma janela
    // de duas horas de madrugada só é apanhada se alguém olhar lá dentro, e
    // a maior parte destas execuções não faz rigorosamente nada.
    defaultIntervalMinutes: 60,
    confirmationsRequired: 1,
  },
}

export function isConnectorCheck(checkType: string): boolean {
  return checkType in CONNECTOR_CHECKS
}
