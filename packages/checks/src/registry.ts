import type { CheckDefinition } from '@jellycare/core'
import { brokenLinksCheck } from './broken-links.js'
import { emailAuthCheck } from './email-auth.js'
import { exposedFilesCheck } from './exposed-files.js'
import { pageSpeedCheck } from './page-speed.js'
import { reputationCheck } from './reputation.js'
import { securityHeadersCheck } from './security-headers.js'
import { tlsCheck } from './tls.js'
import { uptimeCheck } from './uptime.js'

/**
 * Nível de acesso exigido por um check.
 *
 * `verified` marca os checks que só podem correr depois de provada a
 * propriedade do domínio. Uptime é o único que corre sem isso: observar que um
 * URL público responde não é diferente do que faz qualquer visitante.
 * Ver docs/riscos.md.
 */
export type CheckAccessLevel = 'public' | 'verified'

export interface RegisteredCheck {
  definition: CheckDefinition<never>
  access: CheckAccessLevel
  /** Rótulo para o dashboard e para o relatório do cliente. */
  label: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const CHECK_REGISTRY: Record<string, RegisteredCheck> = {
  [uptimeCheck.type]: {
    definition: uptimeCheck as CheckDefinition<any>,
    access: 'public',
    label: 'Disponibilidade',
  },
  [tlsCheck.type]: {
    definition: tlsCheck as CheckDefinition<any>,
    access: 'verified',
    label: 'Certificado SSL',
  },
  [emailAuthCheck.type]: {
    definition: emailAuthCheck as CheckDefinition<any>,
    access: 'verified',
    label: 'Autenticação de email',
  },
  [securityHeadersCheck.type]: {
    definition: securityHeadersCheck as CheckDefinition<any>,
    access: 'verified',
    label: 'Headers de segurança',
  },
  [exposedFilesCheck.type]: {
    definition: exposedFilesCheck as CheckDefinition<any>,
    access: 'verified',
    label: 'Ficheiros expostos',
  },
  [reputationCheck.type]: {
    definition: reputationCheck as CheckDefinition<any>,
    access: 'verified',
    label: 'Reputação e blacklists',
  },
  [brokenLinksCheck.type]: {
    definition: brokenLinksCheck as CheckDefinition<any>,
    access: 'verified',
    label: 'Links quebrados',
  },
  [pageSpeedCheck.type]: {
    definition: pageSpeedCheck as CheckDefinition<any>,
    // A medição é feita pela Google, mas é o site do cliente que é carregado
    // por inteiro, várias vezes, para ser cronometrado. Não é observação
    // passiva, por isso espera pela prova de propriedade.
    access: 'verified',
    label: 'Velocidade das páginas',
  },
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function getCheck(type: string): RegisteredCheck | undefined {
  return CHECK_REGISTRY[type]
}

/** Checks que podem correr para um site, conforme esteja verificado ou não. */
export function checksAvailable(verified: boolean): RegisteredCheck[] {
  return Object.values(CHECK_REGISTRY).filter(
    (check) => verified || check.access === 'public',
  )
}
