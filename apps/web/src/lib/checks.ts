import { CHECK_REGISTRY } from '@jellycare/checks'
import { CONNECTOR_CHECKS } from '@jellycare/connectors'
import { FORM_CHECKS } from '@jellycare/forms'

export interface CheckMeta {
  type: string
  label: string
  access: 'public' | 'verified'
  defaultIntervalMinutes: number
}

/**
 * Todas as verificações que um site pode ter.
 *
 * As agentless vivem no pacote de checks e as de formulários no de formulários,
 * porque estas últimas precisam de base de dados e de browser. Para o painel e
 * para o onboarding a distinção é irrelevante — o que interessa é a lista
 * completa, com um rótulo e a periodicidade por omissão.
 */
export const ALL_CHECKS: CheckMeta[] = [
  ...Object.values(CHECK_REGISTRY).map((check) => ({
    type: check.definition.type,
    label: check.label,
    access: check.access,
    defaultIntervalMinutes: check.definition.defaultIntervalMinutes,
  })),
  ...Object.values(FORM_CHECKS).map((check) => ({
    type: check.type,
    label: check.label,
    access: check.access as 'verified',
    defaultIntervalMinutes: check.defaultIntervalMinutes,
  })),
  ...Object.values(CONNECTOR_CHECKS).map((check) => ({
    type: check.type,
    label: check.label,
    access: check.access as 'verified',
    defaultIntervalMinutes: check.defaultIntervalMinutes,
  })),
]

const BY_TYPE = new Map(ALL_CHECKS.map((check) => [check.type, check]))

export function checkMeta(type: string): CheckMeta | undefined {
  return BY_TYPE.get(type)
}
