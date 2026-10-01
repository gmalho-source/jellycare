import { explicacaoDe, type Severity } from '@jellycare/core'
import type { ReportPeriod } from './period.js'
import type { Incident, UptimeSample } from './uptime.js'

/**
 * O que o relatório mostra para além dos totais: o que foi verificado e
 * passou, o dia a dia da disponibilidade e o registo do que aconteceu.
 *
 * Um mês sem incidentes é o melhor resultado possível, e um relatório que só
 * fala de problemas mostra-o como «0, 0, 0». É daqui que vem a prova de que
 * alguém esteve a olhar.
 */

const FUSO = 'Europe/Lisbon'

/* -------------------------------------------------------------------------- */
/* O que verificámos                                                          */
/* -------------------------------------------------------------------------- */

export type EstadoVerificacao = 'ok' | 'aviso' | 'falha'

export interface ReportCheckItem {
  chave: string
  estado: EstadoVerificacao
  titulo: string
  detalhe: string
}

interface ExecucaoDeSeguranca {
  checkType: string
  status: 'ok' | 'failed'
  startedAt: Date
  metrics?: Record<string, number>
}

interface Aberto {
  checkType: string
  code: string
  severity: Severity
}

function pior(abertos: readonly Aberto[]): EstadoVerificacao {
  if (abertos.some((f) => f.severity === 'critical' || f.severity === 'high')) return 'falha'
  return abertos.length > 0 ? 'aviso' : 'ok'
}

function nomes(abertos: readonly Aberto[]): string {
  return abertos
    .map((f) => explicacaoDe(f.code)?.titulo ?? f.code)
    .map((titulo) => titulo.charAt(0).toLowerCase() + titulo.slice(1))
    .join('; ')
}

function data(instante: Date): string {
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'long', timeZone: FUSO }).format(instante)
}

/**
 * A lista do que foi verificado, com o resultado de cada coisa.
 *
 * Só entra o que correu com sucesso pelo menos uma vez no período. Uma
 * verificação que não correu não pode aparecer com um visto: seria afirmar que
 * olhámos. O juízo vem dos problemas em aberto no fim do período, os mesmos
 * que o resto do relatório conta; os números do detalhe vêm da última
 * execução com sucesso.
 */
export function buildVerificacoes(
  execucoes: readonly ExecucaoDeSeguranca[],
  abertos: readonly Aberto[],
  wordpress: { pendingUpdates: number; coreOutdated: unknown } | null,
): ReportCheckItem[] {
  const ultima = (tipo: string) =>
    execucoes
      .filter((run) => run.checkType === tipo && run.status === 'ok')
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]
  const de = (tipo: string, codigos?: readonly string[]) =>
    abertos.filter((f) => f.checkType === tipo && (!codigos || codigos.includes(f.code)))

  const itens: ReportCheckItem[] = []

  const cabecalhos = ultima('security_headers')
  if (cabecalhos) {
    const semRedirecao = de('security_headers', ['http_not_redirected'])
    const semHsts = de('security_headers', ['missing_hsts'])
    const problemas = [...semRedirecao, ...semHsts]
    itens.push({
      chave: 'https',
      estado: pior(problemas),
      titulo: problemas.length === 0 ? 'Ligação cifrada obrigatória' : 'Ligação cifrada incompleta',
      detalhe:
        problemas.length === 0
          ? 'HTTPS em todas as páginas, com HSTS ativo: o browser nunca fala com o site sem cifra.'
          : `Por resolver: ${nomes(problemas)}.`,
    })
  }

  const tls = ultima('tls')
  if (tls) {
    const problemas = de('tls')
    const dias = tls.metrics?.certDaysRemaining
    const validade =
      typeof dias === 'number'
        ? ` Válido até ${data(new Date(tls.startedAt.getTime() + dias * 86_400_000))}.`
        : ''
    itens.push({
      chave: 'certificado',
      estado: pior(problemas),
      titulo: problemas.length === 0 ? 'Certificado válido' : 'Certificado com problemas',
      detalhe:
        problemas.length === 0
          ? `Renovado automaticamente; avisamos antes de expirar se a renovação falhar.${validade}`
          : `Por resolver: ${nomes(problemas)}.${validade}`,
    })
  }

  const email = ultima('email_auth')
  if (email) {
    const autenticacao = de('email_auth', [
      'spf_missing',
      'spf_permissive',
      'spf_duplicated',
      'dkim_not_found',
      'mx_missing',
      'mx_unresolvable',
    ])
    const seletores = email.metrics?.dkimSelectorsFound
    itens.push({
      chave: 'email',
      estado: pior(autenticacao),
      titulo:
        autenticacao.length === 0 ? 'Email do domínio autenticado' : 'Autenticação do email incompleta',
      detalhe:
        autenticacao.length === 0
          ? `SPF configurado e assinatura DKIM ativa${
              typeof seletores === 'number' && seletores > 0
                ? ` (${seletores} ${seletores === 1 ? 'seletor' : 'seletores'})`
                : ''
            }: os servidores de destino confirmam que o email é vosso.`
          : `Por resolver: ${nomes(autenticacao)}.`,
    })

    const dmarc = de('email_auth', ['dmarc_missing', 'dmarc_policy_none', 'dmarc_partial'])
    itens.push({
      chave: 'dmarc',
      estado: pior(dmarc),
      titulo: dmarc.length === 0 ? 'Domínio protegido contra imitações' : 'Proteção do domínio incompleta (DMARC)',
      detalhe:
        dmarc.length === 0
          ? 'A regra DMARC rejeita email que se faça passar pelo vosso domínio.'
          : `Por resolver: ${nomes(dmarc)}.`,
    })
  }

  const ficheiros = ultima('exposed_files')
  if (ficheiros) {
    const problemas = de('exposed_files')
    const caminhos = ficheiros.metrics?.pathsProbed
    itens.push({
      chave: 'ficheiros',
      estado: pior(problemas),
      titulo: problemas.length === 0 ? 'Nenhum ficheiro sensível exposto' : 'Ficheiros sensíveis acessíveis',
      detalhe:
        problemas.length === 0
          ? `${typeof caminhos === 'number' ? `${caminhos} caminhos` : 'Os caminhos'} habituais de fugas verificados — cópias de segurança, configurações, repositórios. Nenhum acessível.`
          : `Por resolver: ${nomes(problemas)}.`,
    })
  }

  const reputacao = ultima('reputation')
  if (reputacao) {
    const problemas = de('reputation')
    const paginasGoogle = reputacao.metrics?.webRiskUrls
    const urlhaus = reputacao.metrics?.urlhausChecked === 1
    const google = typeof paginasGoogle === 'number' && paginasGoogle > 0
    // As fontes que responderam na última execução, ditas pelo nome. Uma
    // execução antiga, sem esta métrica, cai na frase genérica de antes.
    const fontes = [
      google
        ? `nas listas da Google que o Chrome usa para o aviso de site perigoso (${paginasGoogle} ${paginasGoogle === 1 ? 'página' : 'páginas'})`
        : '',
      urlhaus ? 'no URLhaus, de sites a distribuir malware' : '',
    ].filter(Boolean)
    const pelaGoogle = problemas.some((f) => f.code === 'blacklisted_web_risk')
    itens.push({
      chave: 'reputacao',
      estado: problemas.length > 0 ? 'falha' : 'ok',
      titulo:
        problemas.length > 0
          ? pelaGoogle
            ? 'Página do site marcada pela Google como perigosa'
            : 'Domínio numa lista de malware'
          : google
            ? 'Fora das listas de malware e phishing'
            : 'Fora das listas de malware',
      detalhe:
        problemas.length > 0
          ? 'Tratado como incidente. Detalhe nos pontos em aberto.'
          : fontes.length > 0
            ? `Verificado ${fontes.join(' e ')}. Nenhuma ocorrência.`
            : 'O domínio não aparece em nenhuma lista de sites a distribuir malware.',
    })
  }

  const conteudo = ultima('injected_content')
  if (conteudo) {
    const problemas = de('injected_content')
    const paginas = conteudo.metrics?.pagesAnalysed
    const comparadas = (conteudo.metrics?.comparisons ?? 0) > 0
    const cloaking = problemas.some((f) => f.code.startsWith('cloaking_'))
    itens.push({
      chave: 'conteudo',
      estado: pior(problemas),
      titulo:
        problemas.length === 0
          ? 'Sem código injetado nem conteúdo escondido'
          : cloaking
            ? 'O Google recebe uma versão diferente do site'
            : 'Conteúdo injetado na página',
      detalhe:
        problemas.length > 0
          ? `Por resolver: ${nomes(problemas)}.`
          : `${typeof paginas === 'number' ? `${paginas} ${paginas === 1 ? 'página analisada' : 'páginas analisadas'}` : 'Páginas analisadas'}: sem links de spam escondidos, molduras invisíveis ou código ofuscado${comparadas ? '. A versão que o Google e quem vem da pesquisa recebem é a mesma de um visitante' : ''}.`,
    })
  }

  if (cabecalhos) {
    const faltam = de('security_headers').filter(
      (f) => f.code !== 'http_not_redirected' && f.code !== 'missing_hsts',
    )
    itens.push({
      chave: 'cabecalhos',
      estado: pior(faltam),
      titulo:
        faltam.length === 0
          ? 'Cabeçalhos de segurança completos'
          : `Cabeçalhos de segurança: ${faltam.length} por corrigir`,
      detalhe:
        faltam.length === 0
          ? 'O servidor dá ao browser todas as instruções que limitam o que um atacante consegue fazer.'
          : 'Instruções que o servidor dá ao browser para limitar o que um atacante consegue fazer. Detalhe nos pontos em aberto.',
    })
  }

  if (wordpress) {
    const vulneraveis = de('wp_inventory')
    const desatualizado = wordpress.pendingUpdates > 0 || wordpress.coreOutdated !== null
    itens.push({
      chave: 'wordpress',
      estado: vulneraveis.length > 0 ? pior(vulneraveis) : desatualizado ? 'aviso' : 'ok',
      titulo:
        vulneraveis.length > 0
          ? 'Componentes WordPress com vulnerabilidades conhecidas'
          : desatualizado
            ? 'WordPress com atualizações pendentes'
            : 'WordPress e plugins atualizados',
      detalhe:
        vulneraveis.length > 0
          ? 'Detalhe nos pontos em aberto.'
          : desatualizado
            ? `${wordpress.pendingUpdates} ${wordpress.pendingUpdates === 1 ? 'componente' : 'componentes'} por atualizar à data do relatório.`
            : 'Núcleo, plugins e temas na versão mais recente à data do relatório.',
    })
  }

  return itens
}

/* -------------------------------------------------------------------------- */
/* Dia a dia                                                                  */
/* -------------------------------------------------------------------------- */

export interface ReportDay {
  /** AAAA-MM-DD, no fuso do cliente. */
  dia: string
  /** Só o dia do mês, para o eixo. */
  rotulo: string
  /** Antes de o site entrar no acompanhamento. */
  antes: boolean
  /** Percentagem disponível. Nulo sem observações nesse dia. */
  disponivel: number | null
  /** Tempo médio de resposta. Nulo sem observações com tempo. */
  respostaMs: number | null
}

const chaveDoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Um registo por dia do período, do dia 1 ao último — ou até hoje, num
 * relatório do mês em curso.
 *
 * Os dias antes da entrada no acompanhamento ficam marcados e não a vazio:
 * um dia sem dados porque o site ainda não estava cá não é o mesmo que um dia
 * sem dados porque a monitorização parou.
 */
export function buildDiario(
  period: ReportPeriod,
  monitoredFrom: Date | null,
  amostras: readonly UptimeSample[],
): ReportDay[] {
  const porDia = new Map<string, { total: number; up: number; tempos: number[] }>()
  for (const amostra of amostras) {
    if (amostra.observedAt < period.start || amostra.observedAt >= period.end) continue
    const chave = chaveDoDia.format(amostra.observedAt)
    const dia = porDia.get(chave) ?? { total: 0, up: 0, tempos: [] }
    dia.total++
    if (amostra.up) dia.up++
    if (typeof amostra.responseTimeMs === 'number') dia.tempos.push(amostra.responseTimeMs)
    porDia.set(chave, dia)
  }

  const inicioDoAcompanhamento = monitoredFrom ? chaveDoDia.format(monitoredFrom) : null
  const dias: ReportDay[] = []
  // De meio-dia em meio-dia UTC, para nunca saltar nem repetir um dia com a
  // mudança da hora.
  const primeiro = new Date(period.start.getTime() + 12 * 3_600_000)
  for (let instante = primeiro; instante < period.end; instante = new Date(instante.getTime() + 86_400_000)) {
    const chave = chaveDoDia.format(instante)
    if (dias.at(-1)?.dia === chave) continue
    const registo = porDia.get(chave)
    dias.push({
      dia: chave,
      rotulo: String(Number(chave.slice(8, 10))),
      antes: inicioDoAcompanhamento !== null && chave < inicioDoAcompanhamento,
      disponivel: registo && registo.total > 0 ? (registo.up / registo.total) * 100 : null,
      respostaMs:
        registo && registo.tempos.length > 0
          ? registo.tempos.reduce((total, t) => total + t, 0) / registo.tempos.length
          : null,
    })
  }
  return dias
}

/* -------------------------------------------------------------------------- */
/* Atividade registada                                                        */
/* -------------------------------------------------------------------------- */

export interface ReportEvent {
  quando: Date
  texto: string
}

export interface TimelineInput {
  period: ReportPeriod
  monitoredFrom: Date | null
  findings: readonly {
    code: string
    title: string
    severity: Severity
    firstSeenAt: Date
    resolvedAt?: Date | null
  }[]
  incidents: readonly Incident[]
  updates: readonly { name: string; fromVersion: string | null; toVersion: string | null; orderedAt: Date }[]
  notices: readonly { sentAt: Date; subject: string }[]
  mobile: readonly { startedAt: Date; score: number }[]
}

/** No máximo, para a cronologia caber numa página e continuar a ler-se. */
const MAX_EVENTOS = 14

function titulo(finding: { code: string; title: string }): string {
  return explicacaoDe(finding.code)?.titulo ?? finding.title
}

/** Agrupa por dia o que aconteceu várias vezes no mesmo dia. */
function porDia<T>(itens: readonly T[], quando: (item: T) => Date): T[][] {
  const grupos = new Map<string, T[]>()
  for (const item of itens) {
    const chave = chaveDoDia.format(quando(item))
    grupos.set(chave, [...(grupos.get(chave) ?? []), item])
  }
  return [...grupos.values()]
}

function lista(nomesDeItens: readonly string[]): string {
  const primeiros = nomesDeItens.slice(0, 3)
  const resto = nomesDeItens.length - primeiros.length
  return primeiros.join('; ') + (resto > 0 ? `; e mais ${resto}` : '')
}

/**
 * O registo do mês, por ordem: a entrada no acompanhamento, os problemas
 * detetados e corrigidos, as interrupções, as atualizações aplicadas, os
 * avisos enviados e a evolução da velocidade.
 *
 * É a secção que justifica a avença — o que foi feito, e quando.
 */
export function buildTimeline(input: TimelineInput): ReportEvent[] {
  const { period } = input
  const dentro = (instante: Date | null | undefined): instante is Date =>
    !!instante && instante >= period.start && instante < period.end
  const eventos: ReportEvent[] = []

  if (input.monitoredFrom) {
    eventos.push({ quando: input.monitoredFrom, texto: 'O site entra em acompanhamento.' })
  }

  for (const grupo of porDia(input.findings.filter((f) => dentro(f.firstSeenAt)), (f) => f.firstSeenAt)) {
    const graves = grupo.filter((f) => f.severity === 'critical' || f.severity === 'high').length
    eventos.push({
      quando: grupo[0]!.firstSeenAt,
      texto:
        grupo.length === 1
          ? `Detetado: ${titulo(grupo[0]!).toLowerCase()}.`
          : `${grupo.length} pontos a melhorar detetados${graves === 0 ? ', nenhum grave' : ''}: ${lista(grupo.map((f) => titulo(f).toLowerCase()))}.`,
    })
  }

  for (const grupo of porDia(input.findings.filter((f) => dentro(f.resolvedAt)), (f) => f.resolvedAt!)) {
    eventos.push({
      quando: grupo[0]!.resolvedAt!,
      texto:
        grupo.length === 1
          ? `Corrigido: ${titulo(grupo[0]!).toLowerCase()}.`
          : `${grupo.length} pontos corrigidos: ${lista(grupo.map((f) => titulo(f).toLowerCase()))}.`,
    })
  }

  for (const incidente of input.incidents.filter((i) => dentro(i.start))) {
    const minutos = Math.max(1, Math.round(incidente.durationMs / 60_000))
    eventos.push({
      quando: incidente.start,
      texto: `Interrupção de ${minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${minutos % 60} min`}${
        incidente.ongoing ? ', ainda em curso no fim do período' : ''
      }${incidente.reason ? ` (${incidente.reason})` : ''}.`,
    })
  }

  for (const grupo of porDia(input.updates.filter((u) => dentro(u.orderedAt)), (u) => u.orderedAt)) {
    eventos.push({
      quando: grupo[0]!.orderedAt,
      texto: `${grupo.length === 1 ? 'Atualizado' : `${grupo.length} componentes atualizados`}: ${lista(
        grupo.map((u) => `${u.name}${u.fromVersion && u.toVersion ? ` ${u.fromVersion} → ${u.toVersion}` : ''}`),
      )}.`,
    })
  }

  for (const aviso of input.notices.filter((n) => dentro(n.sentAt))) {
    eventos.push({ quando: aviso.sentAt, texto: `Aviso enviado ao cliente: «${aviso.subject}».` })
  }

  const medicoes = input.mobile
    .filter((m) => dentro(m.startedAt))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  const primeira = medicoes[0]
  const ultima = medicoes.at(-1)
  if (primeira) {
    eventos.push({
      quando: primeira.startedAt,
      texto: `${input.monitoredFrom ? 'Primeira medição' : 'Medição'} de velocidade em telemóvel: ${primeira.score}/100.`,
    })
  }
  if (primeira && ultima && ultima !== primeira) {
    const diferenca = ultima.score - primeira.score
    eventos.push({
      quando: ultima.startedAt,
      texto: `Velocidade em telemóvel: ${ultima.score}/100${
        diferenca === 0 ? ', igual à primeira do mês' : `, ${diferenca > 0 ? '+' : ''}${diferenca} pontos no mês`
      }.`,
    })
  }

  eventos.sort((a, b) => a.quando.getTime() - b.quando.getTime())
  if (eventos.length <= MAX_EVENTOS) return eventos

  // Demasiados: fica o princípio e o fim, que é onde está a história, e uma
  // linha a dizer quantos ficaram de fora em vez de os cortar em silêncio.
  const inicio = eventos.slice(0, MAX_EVENTOS - 5)
  const fim = eventos.slice(-4)
  const omitidos = eventos.length - inicio.length - fim.length
  return [
    ...inicio,
    { quando: fim[0]!.quando, texto: `… e mais ${omitidos} registos neste intervalo.` },
    ...fim,
  ]
}
