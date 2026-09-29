import { LIMIARES } from '@jellycare/checks'
import type { Severity } from '@jellycare/core'
import { SECURITY_CHECK_TYPES } from './checks'

export type Semaforo = 'verde' | 'laranja' | 'vermelho' | 'cinzento'

export interface Leitura {
  semaforo: Semaforo
  /** A palavra ao lado da cor. A cor nunca anda sozinha. */
  estado: string
  detalhe: string
}

/**
 * O semáforo de segurança, pela pior gravidade em aberto.
 *
 * Vermelho com um problema crítico ou elevado, laranja com um médio. Os de
 * gravidade baixa ficam no verde, ditos no detalhe: são recomendações de
 * endurecimento — um cabeçalho que faltava, uma política de email por apertar
 * — e quase todos os sites têm algum. Pô-los a laranja deixava o semáforo
 * laranja em todo o lado, e um semáforo sempre laranja deixa de dizer nada.
 *
 * Só as verificações de segurança contam (ver `SECURITY_CHECK_TYPES`).
 *
 * Antes de a propriedade do domínio estar provada nenhuma delas corre, e
 * «sem ameaças» a verde seria dizer que olhámos quando não olhámos.
 */
export function lerSeguranca(
  abertos: readonly { checkType: string; severity: Severity }[],
  verificado: boolean,
): Leitura {
  if (!verificado) {
    return {
      semaforo: 'cinzento',
      estado: 'Por verificar',
      detalhe: 'Começa quando a propriedade do domínio estiver provada',
    }
  }

  const conta = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const finding of abertos) {
    if (SECURITY_CHECK_TYPES.has(finding.checkType)) conta[finding.severity]++
  }

  const graves = conta.critical + conta.high
  if (graves > 0) {
    return {
      semaforo: 'vermelho',
      estado: 'Requer atenção',
      detalhe: graves === 1 ? '1 problema grave em aberto' : `${graves} problemas graves em aberto`,
    }
  }
  if (conta.medium > 0) {
    return {
      semaforo: 'laranja',
      estado: 'A acompanhar',
      detalhe:
        conta.medium === 1 ? '1 problema médio em aberto' : `${conta.medium} problemas médios em aberto`,
    }
  }
  if (conta.low > 0) {
    return {
      semaforo: 'verde',
      estado: 'Sem ameaças graves',
      detalhe: conta.low === 1 ? '1 recomendação menor' : `${conta.low} recomendações menores`,
    }
  }
  return { semaforo: 'verde', estado: 'Sem ameaças', detalhe: 'Nada em aberto' }
}

/**
 * O desempenho, pela última pontuação em telemóvel.
 *
 * Os limiares são os da Google, os mesmos do mostrador e do check. Telemóvel
 * e não computador porque é o que a Google usa para indexar.
 */
export function lerDesempenho(score: number | null): Leitura {
  if (score === null) {
    return { semaforo: 'cinzento', estado: 'Sem medição', detalhe: 'Aparece depois da próxima medição' }
  }
  const detalhe = `${score}/100 em telemóvel`
  if (score >= LIMIARES.scoreRazoavel) return { semaforo: 'verde', estado: 'Boa', detalhe }
  if (score >= LIMIARES.scoreMau) return { semaforo: 'laranja', estado: 'A melhorar', detalhe }
  return { semaforo: 'vermelho', estado: 'Fraca', detalhe }
}
