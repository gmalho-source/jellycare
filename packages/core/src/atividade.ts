import type { Severity } from './severity.js'

/**
 * O registo de atividade: tudo o que aconteceu num site, por ordem.
 *
 * Os problemas guardam o estado em que estão; o registo guarda o caminho até
 * lá. Um problema que se resolveu, voltou e se resolveu outra vez é uma linha
 * nos problemas e quatro aqui. É deste registo que sai a resposta a «o que é
 * que a Jelly fez por este site», no painel e no relatório.
 *
 * Só se acrescenta. Uma linha nunca é alterada nem apagada, a não ser pela
 * retenção, ao fim do mesmo prazo dos relatórios.
 */
export const TIPOS_DE_ATIVIDADE = [
  'problema_detetado',
  'problema_agravou',
  'problema_reapareceu',
  'problema_resolvido',
  'problema_reconhecido',
  'problema_silenciado',
  'problema_reativado',
  'claude_resolve_pedido',
  'aviso_ao_cliente',
  'wp_atualizado',
  'wp_atualizacao_falhou',
] as const

export type TipoDeAtividade = (typeof TIPOS_DE_ATIVIDADE)[number]

/** O que cada linha pode levar. Tudo opcional: cada tipo usa o seu bocado. */
export interface DadosDaAtividade {
  /** Título do problema, guardado à data: o problema pode ser apagado depois. */
  titulo?: string
  codigo?: string
  severidade?: Severity
  severidadeAnterior?: Severity
  /** Claude Resolve. */
  issue?: { numero: number; url: string; repositorio: string }
  /** Atualizações WordPress. */
  componente?: { tipo: string; nome: string; de?: string | null; para?: string | null; vulneravel?: boolean }
  erro?: string | null
  /** Aviso ao cliente. */
  assunto?: string
  destinatarios?: number
}

/**
 * O que é só da equipa.
 *
 * O cliente vê o que aconteceu ao site dele e o que foi feito; não precisa de
 * ver quem na Jelly silenciou o quê, nem os pedidos internos ao Claude. Um
 * silenciado sem explicação lido por um cliente parece desleixo, mesmo quando
 * é a decisão certa.
 */
const INTERNOS: ReadonlySet<TipoDeAtividade> = new Set([
  'problema_reconhecido',
  'problema_silenciado',
  'problema_reativado',
  'claude_resolve_pedido',
])

export function atividadeInterna(tipo: TipoDeAtividade): boolean {
  return INTERNOS.has(tipo)
}

/** As famílias para filtrar a vista. */
export type FamiliaDeAtividade = 'problemas' | 'equipa' | 'wordpress' | 'avisos'

const FAMILIA: Record<TipoDeAtividade, FamiliaDeAtividade> = {
  problema_detetado: 'problemas',
  problema_agravou: 'problemas',
  problema_reapareceu: 'problemas',
  problema_resolvido: 'problemas',
  problema_reconhecido: 'equipa',
  problema_silenciado: 'equipa',
  problema_reativado: 'equipa',
  claude_resolve_pedido: 'equipa',
  aviso_ao_cliente: 'avisos',
  wp_atualizado: 'wordpress',
  wp_atualizacao_falhou: 'wordpress',
}

export function familiaDaAtividade(tipo: TipoDeAtividade): FamiliaDeAtividade {
  return FAMILIA[tipo]
}

export const FAMILIAS_DE_ATIVIDADE: Record<FamiliaDeAtividade, string> = {
  problemas: 'Problemas',
  equipa: 'Ações da equipa',
  wordpress: 'Atualizações WordPress',
  avisos: 'Avisos ao cliente',
}

export function tiposDaFamilia(familia: FamiliaDeAtividade): TipoDeAtividade[] {
  return TIPOS_DE_ATIVIDADE.filter((tipo) => FAMILIA[tipo] === familia)
}

const NOME_DA_SEVERIDADE: Record<Severity, string> = {
  info: 'informativo',
  low: 'baixo',
  medium: 'médio',
  high: 'alto',
  critical: 'crítico',
}

/**
 * A frase de uma linha do registo, sem o autor nem a data, que a vista põe à
 * parte. Escrita para se ler sozinha: «Resolvido: Falta o header HSTS».
 */
export function descreverAtividade(tipo: TipoDeAtividade, dados: DadosDaAtividade): string {
  const titulo = dados.titulo ?? 'problema'
  switch (tipo) {
    case 'problema_detetado':
      return `Detetado: ${titulo}`
    case 'problema_agravou':
      return dados.severidadeAnterior && dados.severidade
        ? `Agravou de ${NOME_DA_SEVERIDADE[dados.severidadeAnterior]} para ${NOME_DA_SEVERIDADE[dados.severidade]}: ${titulo}`
        : `Agravou: ${titulo}`
    case 'problema_reapareceu':
      return `Voltou a aparecer: ${titulo}`
    case 'problema_resolvido':
      return `Resolvido: ${titulo}`
    case 'problema_reconhecido':
      return `Reconhecido: ${titulo}`
    case 'problema_silenciado':
      return `Silenciado: ${titulo}`
    case 'problema_reativado':
      return `Reativado: ${titulo}`
    case 'claude_resolve_pedido':
      return dados.issue
        ? `Enviado ao Claude Resolve (issue #${dados.issue.numero}): ${titulo}`
        : `Enviado ao Claude Resolve: ${titulo}`
    case 'aviso_ao_cliente':
      return `Aviso enviado ao cliente: ${dados.assunto ?? titulo}`
    case 'wp_atualizado': {
      const c = dados.componente
      if (!c) return 'Atualização WordPress aplicada'
      const versoes = c.de && c.para ? ` ${c.de} → ${c.para}` : c.para ? ` para ${c.para}` : ''
      return `Atualizado: ${c.nome}${versoes}${c.vulneravel ? ' (corrige vulnerabilidade)' : ''}`
    }
    case 'wp_atualizacao_falhou':
      return dados.componente ? `Atualização falhou: ${dados.componente.nome}` : 'Atualização WordPress falhou'
  }
}
