/**
 * Os módulos do relatório mensal.
 *
 * Uma lista só, usada pelo relatório para saber o que desenhar e pelo painel
 * para mostrar o que se pode tirar. Escrita em dois sítios era garantir que
 * um dia o painel oferecia desligar um módulo que já não existia, ou que um
 * módulo novo não tinha interruptor.
 *
 * O resumo não está aqui. É a primeira coisa que o cliente lê e o que ele diz
 * acompanha os módulos: tirar a disponibilidade tira também a frase sobre ela
 * no resumo, em vez de deixar o resumo a falar de uma secção que não existe.
 */
export const REPORT_SECTIONS = [
  {
    key: 'disponibilidade',
    label: 'Disponibilidade',
    description: 'Percentagem de tempo no ar, interrupções e cumprimento do SLA.',
  },
  {
    key: 'seguranca',
    label: 'Segurança',
    description: 'O que foi verificado e passou, os pontos em aberto e o que foi corrigido.',
  },
  {
    key: 'desempenho',
    label: 'Desempenho',
    description: 'Velocidade das páginas em telemóvel e computador, e a evolução no mês.',
  },
  {
    key: 'formularios',
    label: 'Formulários de contacto',
    description: 'Submissões de teste, entrega das notificações e mensagens no spam.',
  },
  {
    key: 'wordpress',
    label: 'WordPress',
    description: 'Atualizações aplicadas, cópias de segurança e o que falta atualizar.',
  },
  {
    key: 'trabalho',
    label: 'Atividade registada',
    description: 'O que aconteceu no mês, por ordem, e quantas verificações correram.',
  },
  {
    key: 'proximos',
    label: 'Próximos passos',
    description: 'O que a Jelly vai fazer a seguir, pela ordem em que vale a pena.',
  },
] as const

export type ReportSectionKey = (typeof REPORT_SECTIONS)[number]['key']

const CHAVES = new Set<string>(REPORT_SECTIONS.map((section) => section.key))

/**
 * Os módulos que entram, a partir dos que foram tirados.
 *
 * Chaves desconhecidas são ignoradas: uma exclusão de um módulo que entretanto
 * deixou de existir não pode fazer rebentar a geração de um relatório.
 */
export function includedSections(excluded: readonly string[]): Set<ReportSectionKey> {
  const fora = new Set(excluded)
  return new Set(
    REPORT_SECTIONS.map((section) => section.key).filter((key) => !fora.has(key)),
  )
}

/** Só as chaves que existem, sem repetidos, pela ordem da lista. */
export function normaliseExcluded(excluded: readonly string[]): ReportSectionKey[] {
  const pedidas = new Set(excluded.filter((key) => CHAVES.has(key)))
  return REPORT_SECTIONS.map((section) => section.key).filter((key) => pedidas.has(key))
}
