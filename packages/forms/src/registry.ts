/**
 * Verificações de formulários.
 *
 * Não são `CheckDefinition` como as agentless: precisam de escrever na base de
 * dados (inventário de formulários, registo de submissões) e de um browser. A
 * orquestração vive no worker; aqui fica apenas o que o agendador e o
 * dashboard precisam de saber sobre elas.
 */
export interface FormCheckMeta {
  type: string
  label: string
  /** Todas exigem propriedade do domínio comprovada — submetem dados no site. */
  access: 'verified'
  defaultIntervalMinutes: number
  confirmationsRequired: number
}

export const FORM_DISCOVERY_CHECK = 'form_discovery'
export const FORM_TEST_CHECK = 'form_test'
export const FORM_DELIVERY_CHECK = 'form_delivery'

export const FORM_CHECKS: Record<string, FormCheckMeta> = {
  [FORM_DISCOVERY_CHECK]: {
    type: FORM_DISCOVERY_CHECK,
    label: 'Descoberta de formulários',
    access: 'verified',
    defaultIntervalMinutes: 60 * 24 * 7,
    confirmationsRequired: 1,
  },
  [FORM_TEST_CHECK]: {
    type: FORM_TEST_CHECK,
    label: 'Teste de formulários',
    access: 'verified',
    defaultIntervalMinutes: 60 * 24,
    confirmationsRequired: 1,
  },
  [FORM_DELIVERY_CHECK]: {
    type: FORM_DELIVERY_CHECK,
    label: 'Entrega das notificações',
    access: 'verified',
    // Corre mais vezes do que o teste porque avalia submissões já feitas: o
    // email pode demorar minutos a chegar, e queremos saber cedo quando não
    // chega de todo.
    defaultIntervalMinutes: 60,
    confirmationsRequired: 1,
  },
}

export function isFormCheck(checkType: string): boolean {
  return checkType in FORM_CHECKS
}
