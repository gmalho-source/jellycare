import type { Severity } from './severity.js'

/**
 * Os semáforos de segurança e de desempenho.
 *
 * Vivem aqui e não no painel porque o portal e o relatório mensal têm de dar a
 * mesma cor ao mesmo site. Escritos em dois sítios, bastava uma alteração para
 * o PDF dizer laranja sobre o que o portal mostra a verde — e é o cliente quem
 * põe os dois lado a lado.
 */

export type Semaforo = 'verde' | 'laranja' | 'vermelho' | 'cinzento'

export interface Leitura {
  semaforo: Semaforo
  /** A palavra ao lado da cor. A cor nunca anda sozinha. */
  estado: string
  detalhe: string
}

/**
 * Os limiares da Google para as pontuações do Lighthouse: 90 para cima é bom,
 * abaixo de 50 é mau. Os mesmos para o semáforo, para os mostradores e para o
 * problema que o check de velocidade abre.
 */
export const PONTUACAO_BOA = 90
export const PONTUACAO_MA = 50

/**
 * As verificações que contam para o semáforo de segurança.
 *
 * Certificado, cabeçalhos, autenticação do email, reputação, ficheiros
 * expostos e vulnerabilidades WordPress. Ficam de fora a disponibilidade, a
 * velocidade, os links partidos e os formulários: são problemas reais, mas
 * não são ameaças, e um semáforo de segurança vermelho por uma página lenta
 * ensinava o cliente a não acreditar nele.
 *
 * `wp_inventory` é o `WP_INVENTORY_CHECK` de `@jellycare/connectors`, escrito
 * à mão porque esse pacote depende deste e não o contrário. Um teste do painel
 * confirma que os dois continuam iguais.
 */
export const SECURITY_CHECK_TYPES: ReadonlySet<string> = new Set([
  'tls',
  'security_headers',
  'email_auth',
  'reputation',
  'exposed_files',
  'wp_inventory',
])

/**
 * O semáforo de segurança, pela pior gravidade em aberto.
 *
 * Vermelho com um problema crítico ou elevado, laranja com um médio. Os de
 * gravidade baixa ficam no verde, ditos no detalhe: são recomendações de
 * endurecimento — um cabeçalho que faltava, uma política de email por apertar
 * — e quase todos os sites têm algum. Pô-los a laranja deixava o semáforo
 * laranja em todo o lado, e um semáforo sempre laranja deixa de dizer nada.
 *
 * Sem verificações de segurança feitas — domínio por provar, ou nenhuma no
 * período — fica cinzento: «sem ameaças» a verde seria dizer que olhámos
 * quando não olhámos.
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
 * O desempenho, pela última pontuação em telemóvel. Telemóvel e não
 * computador porque é o que a Google usa para indexar.
 */
export function lerDesempenho(score: number | null): Leitura {
  if (score === null) {
    return { semaforo: 'cinzento', estado: 'Sem medição', detalhe: 'Aparece depois da próxima medição' }
  }
  const detalhe = `${score}/100 em telemóvel`
  if (score >= PONTUACAO_BOA) return { semaforo: 'verde', estado: 'Boa', detalhe }
  if (score >= PONTUACAO_MA) return { semaforo: 'laranja', estado: 'A melhorar', detalhe }
  return { semaforo: 'vermelho', estado: 'Fraca', detalhe }
}
