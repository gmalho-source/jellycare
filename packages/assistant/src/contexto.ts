/**
 * O que o assistente sabe sobre um problema, e como isso vira texto.
 *
 * Função pura sobre dados já lidos: quem chama é que vai à base de dados. Sem
 * isto, a única forma de ver o que vai dentro do prompt era abrir uma ligação
 * e pagar uma chamada ao modelo.
 */

export interface SiteNoContexto {
  label: string
  url: string
  hostname: string
  /** Propriedade do domínio provada. Muda o que se pode aconselhar. */
  verified: boolean
  state: string
}

export interface ProblemaNoContexto {
  code: string
  checkType: string
  title: string
  detail: string | null
  severity: string
  state: string
  evidence: Record<string, unknown> | null
  firstSeenAt: Date
  lastSeenAt: Date
  occurrences: number
}

export interface ExecucaoNoContexto {
  startedAt: Date
  status: string
  durationMs: number
  error: string | null
  warnings: string[]
  metrics: Record<string, number>
}

export interface ComponenteNoContexto {
  kind: string
  name: string
  version: string | null
  latestVersion: string | null
  active: boolean
}

export interface ContextoDoProblema {
  site: SiteNoContexto
  problema: ProblemaNoContexto
  /** As últimas execuções do mesmo check, da mais recente para a mais antiga. */
  execucoes: ExecucaoNoContexto[]
  /** Inventário WordPress, quando o site está ligado a uma ferramenta. */
  wordpress: { componentes: ComponenteNoContexto[]; recolhidoEm: Date | null } | null
  /** Está dentro de uma janela de manutenção neste momento. */
  emManutencao: boolean
}

const DATA = new Intl.DateTimeFormat('pt-PT', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Lisbon',
})

function quando(valor: Date): string {
  return DATA.format(valor)
}

function dias(desde: Date, ate: Date): number {
  return Math.max(0, Math.round((ate.getTime() - desde.getTime()) / 86_400_000))
}

/**
 * A evidência recolhida pelo check, em texto.
 *
 * Isto é a parte do contexto que **não** é nossa: um `Server:` ou um corpo de
 * resposta vêm do site de um terceiro, que pode ter lá escrito qualquer coisa
 * — incluindo instruções dirigidas a um modelo. Vai marcada como dados e o
 * prompt de sistema diz que dados nunca são instruções. Truncada porque um
 * campo enorme não acrescenta nada e empurra o resto do contexto para fora.
 */
function evidenciaEmTexto(evidence: Record<string, unknown>): string[] {
  return Object.entries(evidence).map(([chave, valor]) => {
    const texto = typeof valor === 'string' ? valor : JSON.stringify(valor)
    const cortado = texto.length > 500 ? `${texto.slice(0, 500)}… (truncado)` : texto
    return `  ${chave}: ${cortado}`
  })
}

/** Só os componentes que interessam: os que estão por atualizar. */
function porAtualizar(componentes: ComponenteNoContexto[]): ComponenteNoContexto[] {
  return componentes.filter((componente) => componente.latestVersion !== null)
}

export function montarContexto(contexto: ContextoDoProblema, agora: Date): string {
  const { site, problema, execucoes, wordpress } = contexto
  const linhas: string[] = []

  linhas.push('<site>')
  linhas.push(`  nome: ${site.label}`)
  linhas.push(`  endereço: ${site.url}`)
  linhas.push(`  estado: ${site.state}`)
  linhas.push(
    site.verified
      ? '  propriedade do domínio: provada'
      : '  propriedade do domínio: POR PROVAR — só a disponibilidade é verificada, e não temos autorização para sugerir nada que toque no servidor',
  )
  if (contexto.emManutencao) {
    linhas.push('  janela de manutenção: aberta neste momento, os alertas estão suspensos')
  }
  linhas.push('</site>')

  linhas.push('<problema>')
  linhas.push(`  código: ${problema.code}`)
  linhas.push(`  verificação: ${problema.checkType}`)
  linhas.push(`  título: ${problema.title}`)
  if (problema.detail) linhas.push(`  descrição: ${problema.detail}`)
  linhas.push(`  gravidade: ${problema.severity}`)
  linhas.push(`  estado: ${problema.state}`)
  linhas.push(
    `  detetado em ${quando(problema.firstSeenAt)}, há ${dias(problema.firstSeenAt, agora)} dias`,
  )
  linhas.push(
    `  visto pela última vez em ${quando(problema.lastSeenAt)}, em ${problema.occurrences} observações`,
  )
  linhas.push('</problema>')

  if (problema.evidence && Object.keys(problema.evidence).length > 0) {
    linhas.push('<evidencia>')
    linhas.push(...evidenciaEmTexto(problema.evidence))
    linhas.push('</evidencia>')
  }

  if (execucoes.length > 0) {
    linhas.push('<execucoes-recentes>')
    for (const execucao of execucoes) {
      const partes = [`  ${quando(execucao.startedAt)} — ${execucao.status}`, `${execucao.durationMs} ms`]
      if (execucao.error) partes.push(`erro: ${execucao.error}`)
      if (execucao.warnings.length > 0) partes.push(`avisos: ${execucao.warnings.join('; ')}`)
      const metricas = Object.entries(execucao.metrics)
      if (metricas.length > 0) {
        partes.push(metricas.map(([chave, valor]) => `${chave}=${valor}`).join(' '))
      }
      linhas.push(partes.join(' · '))
    }
    linhas.push('</execucoes-recentes>')
  }

  if (wordpress) {
    const desatualizados = porAtualizar(wordpress.componentes)
    linhas.push('<wordpress>')
    linhas.push(
      `  ${wordpress.componentes.length} componentes no inventário, ${desatualizados.length} por atualizar` +
        (wordpress.recolhidoEm ? `, recolhido em ${quando(wordpress.recolhidoEm)}` : ', ainda sem recolha'),
    )
    for (const componente of desatualizados) {
      linhas.push(
        `  ${componente.kind}: ${componente.name} ${componente.version ?? '?'} → ${componente.latestVersion}` +
          (componente.active ? '' : ' (inativo)'),
      )
    }
    linhas.push('</wordpress>')
  } else {
    linhas.push('<wordpress>não está ligado a nenhuma ferramenta de manutenção</wordpress>')
  }

  return linhas.join('\n')
}
