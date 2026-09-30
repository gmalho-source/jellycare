import { explicacaoDe, type Leitura, type Severity } from '@jellycare/core'
import type { ReportData } from './build.js'
import { formatDuration, formatPercent } from './build.js'
import { COR, COR_SEMAFORO, corDaPontuacao, fracao, linha, mostrador, tiraDiaria } from './graficos.js'

/**
 * Template do relatório.
 *
 * Pensado para ser impresso: A4, quebras de página controladas e nada que
 * dependa de interação. O cliente recebe isto em PDF anexo a um email e,
 * muitas vezes, imprime-o para levar a uma reunião.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Crítico',
  high: 'Elevado',
  medium: 'Médio',
  low: 'Baixo',
  info: 'Informativo',
}

const SEVERITY_COLOR: Record<Severity, { bg: string; fg: string }> = {
  critical: { bg: '#fde3e7', fg: '#a32233' },
  high: { bg: '#ffedd5', fg: '#9a3412' },
  medium: { bg: '#fef3c7', fg: '#854d0e' },
  low: { bg: '#e0f2fe', fg: '#075985' },
  info: { bg: '#eeeef1', fg: '#55555f' },
}

const CHECK_LABEL: Record<string, string> = {
  uptime: 'Disponibilidade',
  tls: 'Certificado SSL',
  email_auth: 'Autenticação de email',
  security_headers: 'Cabeçalhos de segurança',
  exposed_files: 'Ficheiros expostos',
  reputation: 'Reputação e listas de malware',
  broken_links: 'Links quebrados',
  form_discovery: 'Descoberta de formulários',
  form_test: 'Teste de formulários',
  form_delivery: 'Entrega das notificações',
  page_speed: 'Velocidade em telemóvel',
  page_speed_desktop: 'Velocidade em computador',
  wp_inventory: 'Inventário WordPress',
  wp_auto_update: 'Atualizações WordPress',
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'long',
    timeZone: 'Europe/Lisbon',
  }).format(date)
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Lisbon',
  }).format(date)
}

function severityPill(severity: Severity): string {
  const colors = SEVERITY_COLOR[severity]
  return `<span class="pill" style="background:${colors.bg};color:${colors.fg}">${
    SEVERITY_LABEL[severity]
  }</span>`
}


/** Um indicador da primeira página. */
interface Indicador {
  rotulo: string
  valor: string
  rodape: string
  cor?: string
}

function indicadores(data: ReportData): Indicador[] {
  const lista: Indicador[] = []
  const { uptime, performance, activity, findings } = data
  const inclui = (chave: string) => (data.sections as string[]).includes(chave)

  if (inclui('disponibilidade')) {
    lista.push({
      rotulo: 'Disponibilidade',
      valor: uptime.uptimePercent === null ? '—' : formatPercent(uptime.uptimePercent),
      rodape:
        uptime.uptimePercent === null
          ? 'sem observações no período'
          : `${uptime.incidents.length} ${uptime.incidents.length === 1 ? 'interrupção' : 'interrupções'}${
              uptime.slaMet === null
                ? ' · valor indicativo'
                : uptime.slaMet
                  ? ` · SLA ${formatPercent(uptime.slaTarget)} cumprido`
                  : ` · abaixo do SLA de ${formatPercent(uptime.slaTarget)}`
            }`,
      ...(uptime.uptimePercent === null ? {} : { cor: uptime.slaMet === false ? COR.mau : COR.bom }),
    })
    if (uptime.averageResponseTimeMs !== null) {
      lista.push({
        rotulo: 'Tempo de resposta',
        valor: `${Math.round(uptime.averageResponseTimeMs)} ms`,
        rodape: data.monitoredFrom ? 'média do período acompanhado' : 'média do mês',
      })
    }
  }

  if (inclui('desempenho') && performance.mobile?.latestScore != null) {
    const { latestScore, firstScore, runs } = performance.mobile
    const delta = firstScore !== null && runs > 1 ? latestScore - firstScore : null
    lista.push({
      rotulo: 'Desempenho',
      valor: String(latestScore),
      rodape: `em 100, telemóvel${delta ? ` · ${delta > 0 ? '+' : ''}${delta} pontos` : ''}`,
      cor: corDaPontuacao(latestScore),
    })
  }

  if (inclui('seguranca') && lista.length < 4) {
    lista.push({
      rotulo: 'Pontos em aberto',
      valor: String(findings.stillOpen),
      rodape: `${findings.resolved} ${findings.resolved === 1 ? 'corrigido' : 'corrigidos'} no mês`,
    })
  }

  if (activity.checksRun > 0 && lista.length < 4) {
    lista.push({
      rotulo: 'Verificações',
      valor: activity.checksRun.toLocaleString('pt-PT', { useGrouping: 'always' } as Intl.NumberFormatOptions),
      rodape: 'corridas automaticamente',
    })
  }

  return lista.slice(0, 4)
}

const ICONE_ESCUDO =
  '<path d="M8 1.8 13 3.6v4.1c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5V3.6z"/><path d="m5.8 8 1.6 1.6 2.9-3"/>'
const ICONE_VELOCIDADE = '<path d="M2.6 12a5.6 5.6 0 1 1 10.8 0"/><path d="m8 12 2.8-3.4"/>'

function cartaoDeEstado(titulo: string, icone: string, leitura: Leitura): string {
  const cor = COR_SEMAFORO[leitura.semaforo]
  return `<div class="estado-card">
    <div class="estado-icon" style="background:${cor}14;color:${cor}">
      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${icone}</svg>
    </div>
    <div>
      <div class="estado-titulo">${titulo}</div>
      <div class="estado-linha"><span class="dot" style="background:${cor}"></span>${escapeHtml(leitura.estado)}</div>
      <div class="estado-detalhe">${escapeHtml(leitura.detalhe)}</div>
    </div>
  </div>`
}

/** A primeira página: como está o site, em quatro números e duas cores. */
function primeiraPagina(data: ReportData): string {
  const { seguranca, desempenho } = data.estado
  const cartoes = [
    seguranca ? cartaoDeEstado('Segurança', ICONE_ESCUDO, seguranca) : '',
    desempenho ? cartaoDeEstado('Desempenho', ICONE_VELOCIDADE, desempenho) : '',
  ].join('')

  const lista = indicadores(data)

  return `${
    cartoes
      ? `<section class="block"><h2>Estado geral</h2><div class="estado">${cartoes}</div></section>`
      : ''
  }
  ${
    lista.length > 0
      ? `<section class="block"><h2>Indicadores do mês</h2><div class="kpis">${lista
          .map(
            (kpi) => `<div class="kpi">
              <span class="kpi-label">${escapeHtml(kpi.rotulo)}</span>
              <span class="kpi-value"${kpi.cor ? ` style="color:${kpi.cor}"` : ''}>${escapeHtml(kpi.valor)}</span>
              <span class="kpi-foot">${escapeHtml(kpi.rodape)}</span>
            </div>`,
          )
          .join('')}</div></section>`
      : ''
  }`
}

function uptimeSection(data: ReportData): string {
  const { uptime } = data

  if (uptime.uptimePercent === null) {
    return `<section class="block">
      <h2>Disponibilidade</h2>
      <p class="empty">Não há observações de disponibilidade neste período.</p>
    </section>`
  }

  const slaLine =
    uptime.slaMet === null
      ? `<span class="muted">Cobertura de ${formatPercent((uptime.coverage ?? 0) * 100)} do ${
          data.monitoredFrom ? 'período acompanhado' : 'período'
        } — valor indicativo</span>`
      : uptime.slaMet
        ? `<span class="ok">cumprido</span>`
        : `<span class="bad">não cumprido</span>`

  const tempos = data.diario
    .filter((dia) => dia.respostaMs !== null)
    .map((dia) => ({ rotulo: `${dia.dia.slice(8, 10)}/${dia.dia.slice(5, 7)}`, valor: Math.round(dia.respostaMs!) }))
  const graficoTempos = linha(tempos, { minimoDoTeto: 600 })

  const incidents =
    uptime.incidents.length === 0
      ? '<p class="empty">Nenhuma interrupção registada.</p>'
      : `<table>
          <thead><tr><th>Início</th><th>Fim</th><th>Duração</th><th>Causa</th></tr></thead>
          <tbody>
            ${uptime.incidents
              .map(
                (incident) => `<tr>
                  <td>${formatDateTime(incident.start)}</td>
                  <td>${incident.ongoing ? '<span class="muted">em curso</span>' : formatDateTime(incident.end)}</td>
                  <td>${formatDuration(incident.durationMs)}</td>
                  <td>${escapeHtml(incident.reason ?? '—')}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>`

  return `<section class="block">
    <h2>Disponibilidade</h2>
    <p class="muted" style="margin:0 0 6px">Dia a dia${data.monitoredFrom ? ', desde a entrada no acompanhamento' : ''}</p>
    ${tiraDiaria(data.diario, uptime.slaTarget)}
    <table style="margin-top:6px">
      <tr><td>Disponível</td><td class="right num">${formatPercent(uptime.uptimePercent)}</td>
          <td>Interrupções</td><td class="right num">${uptime.incidents.length}</td></tr>
      <tr><td>Objetivo contratado (SLA)</td><td class="right num">${formatPercent(uptime.slaTarget)} · ${slaLine}</td>
          <td>Tempo indisponível</td><td class="right num">${formatDuration(uptime.totalDowntimeMs)}</td></tr>
    </table>
    ${
      graficoTempos
        ? `<h3>Tempo de resposta do servidor</h3>${graficoTempos}
           <p class="muted" style="margin:2px 0 0">Média de cada dia, em milissegundos. Abaixo de 800 ms é rápido.</p>`
        : ''
    }
    ${uptime.incidents.length > 0 ? '<h3>Interrupções</h3>' : ''}
    ${incidents}
  </section>`
}

const MARCA: Record<string, { simbolo: string; classe: string }> = {
  ok: { simbolo: '✓', classe: 'ok' },
  aviso: { simbolo: '!', classe: 'warn' },
  falha: { simbolo: '✕', classe: 'bad' },
}

function findingsSection(data: ReportData): string {
  const { findings } = data

  const verificado =
    data.verificacoes.length === 0
      ? ''
      : `<section class="block">
          <h2>Segurança — o que verificámos</h2>
          <ul class="check">
            ${data.verificacoes
              .map((item) => {
                const marca = MARCA[item.estado]!
                return `<li data-verificacao="${item.chave}" data-estado="${item.estado}">
                  <span class="mark ${marca.classe}">${marca.simbolo}</span>
                  <div><div class="check-title">${escapeHtml(item.titulo)}</div>
                  <div class="check-detail">${escapeHtml(item.detalhe)}</div></div>
                </li>`
              })
              .join('')}
          </ul>
        </section>`

  const abertos =
    findings.highlights.length === 0
      ? '<p class="empty">Nenhum ponto em aberto no fim do período.</p>'
      : `<table>
          <thead><tr><th style="width:74px">Gravidade</th><th>O que é</th><th>O que fazemos</th></tr></thead>
          <tbody>
            ${findings.highlights
              .map((finding) => {
                // O mesmo texto que o cliente lê no portal: o relatório é a
                // versão em papel da mesma conversa.
                const explicacao = explicacaoDe(finding.code)
                return `<tr>
                  <td>${severityPill(finding.severity)}</td>
                  <td><strong>${escapeHtml(explicacao?.titulo ?? finding.title)}</strong>
                    ${finding.discriminator ? `<div class="mono">${escapeHtml(finding.discriminator)}</div>` : ''}
                    ${explicacao ? `<div class="check-detail">${escapeHtml(explicacao.oQueE)}</div>` : finding.detail ? `<div class="check-detail">${escapeHtml(finding.detail)}</div>` : ''}
                    <div class="muted">Detetado a ${formatDate(finding.firstSeenAt)}</div></td>
                  <td>${explicacao ? escapeHtml(explicacao.oQueFazemos) : '<span class="muted">A equipa analisa e propõe a correção.</span>'}</td>
                </tr>`
              })
              .join('')}
          </tbody>
        </table>
        ${
          findings.stillOpen > findings.highlights.length
            ? `<p class="muted">E mais ${findings.stillOpen - findings.highlights.length} de gravidade menor, no portal.</p>`
            : ''
        }`

  const resolved =
    findings.resolvedHighlights.length === 0
      ? ''
      : `<h3>Corrigido durante o mês</h3>
         <ul class="resolved">
           ${findings.resolvedHighlights
             .map(
               (finding) =>
                 `<li>${severityPill(finding.severity)} ${escapeHtml(
                   explicacaoDe(finding.code)?.titulo ?? finding.title,
                 )}</li>`,
             )
             .join('')}
         </ul>`

  return `${verificado}
  <section class="block">
    <h2>Pontos em aberto</h2>
    ${abertos}
    <p class="muted" style="margin:6px 0 0">Detetados no mês: ${findings.opened} · Corrigidos: ${findings.resolved} · Em aberto: ${findings.stillOpen}</p>
    ${resolved}
  </section>`
}

function activitySection(data: ReportData): string {
  const { activity } = data
  if (activity.checksRun === 0 && data.atividade.length === 0) return ''

  const cronologia =
    data.atividade.length === 0
      ? '<p class="empty">Nada a registar além das verificações de rotina.</p>'
      : `<ul class="timeline">
          ${data.atividade
            .map(
              (evento) => `<li><div class="when">${new Intl.DateTimeFormat('pt-PT', {
                day: 'numeric',
                month: 'short',
                timeZone: 'Europe/Lisbon',
              })
                .format(evento.quando)
                .replace('.', '')}</div>${escapeHtml(evento.texto)}</li>`,
            )
            .join('')}
        </ul>`

  const tabela =
    activity.checksRun === 0
      ? ''
      : `<table>
      <thead><tr><th>Verificação</th><th class="right">Execuções</th></tr></thead>
      <tbody>
        ${activity.byType
          .map(
            (entry) => `<tr>
              <td>${escapeHtml(CHECK_LABEL[entry.checkType] ?? entry.checkType)}</td>
              <td class="right num">${entry.runs.toLocaleString('pt-PT', { useGrouping: 'always' } as Intl.NumberFormatOptions)}</td>
            </tr>`,
          )
          .join('')}
        <tr><td><strong>Total</strong></td><td class="right num"><strong>${activity.checksRun.toLocaleString('pt-PT', { useGrouping: 'always' } as Intl.NumberFormatOptions)}</strong></td></tr>
      </tbody>
    </table>`

  return `<section class="block">
    <h2>Atividade registada</h2>
    <div class="two"><div>${cronologia}</div><div>${tabela}</div></div>
  </section>`
}

/** Os limiares da Google: 90 para cima é bom, abaixo de 50 é mau. */
function scoreClass(score: number | null): string {
  if (score === null) return ''
  if (score >= 90) return 'ok'
  if (score < 50) return 'bad'
  return ''
}

function segundos(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} s`
}

function performanceSection(data: ReportData): string {
  const { mobile, desktop } = data.performance
  if (!mobile && !desktop) {
    return `<section class="block">
      <h2>Desempenho</h2>
      <p class="empty">Não houve medições de velocidade neste período.</p>
    </section>`
  }

  const principal = mobile ?? desktop!
  const dispositivo = mobile ? 'telemóvel' : 'computador'
  const serie = principal.series.map((ponto) => ({
    rotulo: new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Lisbon' }).format(ponto.startedAt),
    valor: ponto.score,
  }))
  const evolucao = linha(serie, { maximo: 100, largura: 260 })
  const vital = (nome: string, valor: string, bom: boolean | null) =>
    `<tr><td>${nome}</td><td class="right num ${bom === null ? '' : bom ? 'ok' : 'bad'}">${valor}</td></tr>`

  return `<section class="block">
    <h2>Desempenho</h2>
    <div class="gauges">
      <div class="gauge">${mostrador(principal.latestScore, 'Desempenho')}<div class="gauge-label">Desempenho</div></div>
      <div class="gauge">${mostrador(principal.accessibility, 'Acessibilidade')}<div class="gauge-label">Acessibilidade</div></div>
      <div class="gauge">${mostrador(principal.bestPractices, 'Práticas recomendadas')}<div class="gauge-label">Práticas recomendadas</div></div>
      <div class="gauge">${mostrador(principal.seo, 'SEO')}<div class="gauge-label">SEO</div></div>
      <div class="gauge">${fracao(principal.agentic)}<div class="gauge-label">Navegação com agência</div></div>
    </div>
    <p class="legend"><span><span class="dot" style="background:${COR.mau}"></span> 0–49</span><span><span class="dot" style="background:${COR.medio}"></span> 50–89</span><span><span class="dot" style="background:${COR.bom}"></span> 90–100</span> · medido em ${dispositivo} pela PageSpeed Insights</p>
    <div class="two" style="margin-top:8px">
      <div>
        ${evolucao ? `<h3 style="margin-top:4px">Evolução no mês</h3>${evolucao}` : '<p class="muted">Uma só medição no período: a evolução aparece a partir da segunda.</p>'}
      </div>
      <div>
        <h3 style="margin-top:4px">O que pesa</h3>
        <table>
          ${vital('Maior elemento visível (LCP)', segundos(principal.lcpMs), principal.lcpMs === null ? null : principal.lcpMs <= 2500)}
          ${vital('Estabilidade visual (CLS)', principal.cls === null ? '—' : principal.cls.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), principal.cls === null ? null : principal.cls <= 0.1)}
          ${vital('Resposta a cliques (TBT)', principal.tbtMs === null ? '—' : `${Math.round(principal.tbtMs)} ms`, principal.tbtMs === null ? null : principal.tbtMs <= 200)}
        </table>
        ${
          mobile && desktop?.latestScore != null
            ? `<p class="muted" style="margin:6px 0 0">Em computador: <span class="${scoreClass(desktop.latestScore)}">${desktop.latestScore}</span>/100.</p>`
            : ''
        }
      </div>
    </div>
  </section>`
}


function formsSection(data: ReportData): string {
  const { forms } = data

  if (forms.submissions === 0) {
    return `<section class="block">
      <h2>Formulários de contacto</h2>
      <p class="empty">Não foram testados formulários neste período.</p>
    </section>`
  }

  const perdidos = forms.submissionFailures + forms.notDelivered

  return `<section class="block">
    <h2>Formulários de contacto</h2>
    <div class="metrics">
      <div class="metric">
        <span class="metric-value">${forms.submissions}</span>
        <span class="metric-label">Testes realizados</span>
      </div>
      <div class="metric">
        <span class="metric-value">${forms.delivered}</span>
        <span class="metric-label">Notificações recebidas</span>
      </div>
      <div class="metric">
        <span class="metric-value ${perdidos > 0 ? 'bad' : ''}">${perdidos}</span>
        <span class="metric-label">Falhas</span>
      </div>
      <div class="metric">
        <span class="metric-value">${
          forms.averageLatencyMs === null
            ? '—'
            : `${Math.round(forms.averageLatencyMs / 1000)} s`
        }</span>
        <span class="metric-label">Tempo até chegar</span>
      </div>
    </div>
    <p class="note">
      Cada teste preenche e submete o formulário do site com dados identificados como
      verificação automática, e confirma que a notificação chega mesmo à caixa de correio.
      ${
        forms.landedInSpam > 0
          ? `<strong>${forms.landedInSpam} ${
              forms.landedInSpam === 1 ? 'notificação foi classificada' : 'notificações foram classificadas'
            } como spam.</strong>`
          : ''
      }
    </p>
  </section>`
}


function wordpressSection(data: ReportData): string {
  const wp = data.wordpress
  if (!wp) return ''

  const linhas: string[] = []
  linhas.push(
    wp.updatesApplied.length === 0
      ? 'Não foi aplicada nenhuma atualização durante o mês.'
      : `Foram aplicadas <strong>${wp.updatesApplied.length}</strong> ${wp.updatesApplied.length === 1 ? 'atualização' : 'atualizações'}.`,
  )
  if (wp.updatesFailed > 0) {
    linhas.push(
      `${wp.updatesFailed} ${wp.updatesFailed === 1 ? 'atualização falhou e foi revista' : 'atualizações falharam e foram revistas'} pela equipa.`,
    )
  }
  linhas.push(
    wp.backups === 0
      ? '<span class="bad">Não houve nenhuma cópia de segurança concluída durante o mês.</span>'
      : `Foram feitas <strong>${wp.backups}</strong> ${wp.backups === 1 ? 'cópia' : 'cópias'} de segurança; a última a ${formatDate(wp.lastBackupAt!)}.`,
  )
  if (wp.coreOutdated) {
    linhas.push(
      `O WordPress está na versão ${escapeHtml(wp.coreOutdated.version ?? '?')}; a mais recente é a ${escapeHtml(wp.coreOutdated.latestVersion)}.`,
    )
  }
  linhas.push(
    wp.pendingUpdates === 0
      ? 'Todos os plugins e temas estão atualizados à data deste relatório.'
      : `Ficam ${wp.pendingUpdates} ${wp.pendingUpdates === 1 ? 'plugin ou tema' : 'plugins ou temas'} por atualizar à data deste relatório.`,
  )

  const tabela =
    wp.updatesApplied.length === 0
      ? ''
      : `<table>
      <thead><tr><th>Componente</th><th>De</th><th>Para</th><th class="right">Data</th></tr></thead>
      <tbody>
        ${wp.updatesApplied
          .slice(0, 15)
          .map(
            (update) => `<tr>
              <td>${escapeHtml(update.name)}</td>
              <td>${escapeHtml(update.fromVersion ?? '—')}</td>
              <td>${escapeHtml(update.toVersion ?? '—')}</td>
              <td class="right">${formatDate(update.orderedAt)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>`

  return `<section class="block">
    <h2>WordPress</h2>
    ${linhas.map((linha) => `<p class="note">${linha}</p>`).join('')}
    ${tabela}
  </section>`
}

/**
 * As notas da equipa, logo a seguir ao resumo.
 *
 * É a voz de uma pessoa num documento que é todo gerado, e é por isso que vem
 * primeiro: o que a equipa quis dizer ao cliente este mês não pode ficar
 * enterrado depois da tabela de verificações. O texto vai tal como foi
 * escrito, com as quebras de linha, e escapado.
 */
function notesSection(data: ReportData): string {
  if (data.notes.length === 0) return ''
  return `<section class="block team-notes">
    <h2>${data.notes.length === 1 ? 'Nota da equipa' : 'Notas da equipa'}</h2>
    ${data.notes
      .map((nota) => `<p>${escapeHtml(nota).replace(/\n/g, '<br>')}</p>`)
      .join('')}
  </section>`
}

/**
 * A linha de autoria. No PDF vai no rodapé de cada página, ao lado da
 * numeração: no fim do corpo, caía às vezes sozinha numa página em branco.
 */
export function rodape(data: ReportData): string {
  return `Relatório gerado automaticamente por ${data.brand.name} em ${formatDate(data.generatedAt)} · ${data.brand.url}`
}

export function renderReportHtml(data: ReportData): string {
  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<title>${escapeHtml(data.site.label)} — ${escapeHtml(data.period.label)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #17171c;
    font-size: 10.5pt;
    line-height: 1.5;
  }

  header { border-bottom: 2px solid #dd364a; padding-bottom: 12px; margin-bottom: 22px; }
  .brand { color: #dd364a; font-size: 15pt; font-weight: 700; letter-spacing: -0.01em; }
  .brand span { color: #8b8b96; font-size: 9pt; font-weight: 400; }
  h1 { font-size: 17pt; margin: 14px 0 2px; letter-spacing: -0.01em; }
  .subtitle { color: #55555f; margin: 0; }

  h2 {
    font-size: 11pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #8b8b96;
    margin: 0 0 12px;
  }
  h3 { font-size: 10.5pt; margin: 18px 0 8px; }

  /* Uma secção nunca começa no fim de uma página só para virar logo a seguir. */
  .block { margin-bottom: 26px; page-break-inside: avoid; }

  .summary { background: #f8f8f9; border-left: 3px solid #dd364a; padding: 14px 16px; }
  .summary p { margin: 0 0 6px; }
  .summary p:last-child { margin-bottom: 0; }

  .team-notes { border: 1px solid #dcdce2; border-radius: 6px; padding: 14px 16px; }
  .team-notes h2 { margin-top: 0; }
  .team-notes p { margin: 0 0 8px; }
  .team-notes p:last-child { margin-bottom: 0; }

  .metrics { display: flex; gap: 10px; margin-bottom: 14px; }
  .metric {
    flex: 1;
    border: 1px solid #dcdce2;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .metric-value { display: block; font-size: 16pt; font-weight: 600; letter-spacing: -0.02em; }
  .metric-label { display: block; font-size: 8pt; color: #8b8b96; text-transform: uppercase; letter-spacing: 0.04em; }

  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { text-align: left; color: #8b8b96; font-weight: 500; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #dcdce2; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #eeeef1; vertical-align: top; }
  .right { text-align: right; }

  .pill { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 8pt; font-weight: 600; }
  .severity-counts { list-style: none; display: flex; gap: 14px; padding: 0; margin: 0 0 14px; }

  ul.findings { list-style: none; padding: 0; margin: 0; }
  ul.findings li { border-top: 1px solid #eeeef1; padding: 10px 0; page-break-inside: avoid; }
  ul.findings li:first-child { border-top: none; }
  .finding-head { display: flex; gap: 8px; align-items: baseline; }
  ul.findings p { margin: 6px 0 4px; color: #55555f; }

  ul.resolved { list-style: none; padding: 0; margin: 0; }
  ul.resolved li { padding: 4px 0; color: #55555f; }

  ul.recommendations { margin: 0; padding-left: 18px; }
  ul.recommendations li { margin-bottom: 6px; }

  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.5pt; color: #8b8b96; word-break: break-all; }
  .muted { color: #8b8b96; font-size: 8.5pt; }
  .note { color: #55555f; margin: 0 0 12px; }
  .empty { color: #8b8b96; font-style: italic; }
  .ok { color: #166534; font-weight: 600; }
  .bad { color: #a32233; font-weight: 600; }
  .sla { margin: 0 0 14px; }

  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #dcdce2; color: #8b8b96; font-size: 8.5pt; }
  @media print { footer { display: none; } }

  /* A primeira página responde a «está tudo bem?»; o detalhe começa na seguinte. */
  .quebra { page-break-after: always; }
  .num { font-variant-numeric: tabular-nums; }
  .two { display: flex; gap: 16px; }
  .two > div { flex: 1; min-width: 0; }

  .estado { display: flex; gap: 10px; }
  .estado-card { flex: 1; display: flex; gap: 12px; align-items: center; border: 1px solid #dcdce2; border-radius: 8px; padding: 12px 14px; }
  .estado-icon { width: 38px; height: 38px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .estado-titulo { font-weight: 650; font-size: 10.5pt; }
  .estado-linha { display: flex; align-items: center; gap: 6px; color: #33333b; }
  .estado-detalhe { color: #8b8b96; font-size: 8.5pt; }
  .dot { width: 8px; height: 8px; border-radius: 99px; display: inline-block; flex-shrink: 0; }

  .kpis { display: flex; gap: 10px; }
  .kpi { flex: 1; background: #f8f8f9; border-radius: 8px; padding: 11px 12px; }
  .kpi-label { display: block; font-size: 7.5pt; color: #8b8b96; text-transform: uppercase; letter-spacing: 0.05em; }
  .kpi-value { display: block; font-size: 19pt; font-weight: 650; letter-spacing: -0.02em; margin-top: 2px; }
  .kpi-foot { display: block; font-size: 8pt; color: #6b6b75; }

  ul.check { list-style: none; margin: 0; padding: 0; }
  ul.check li { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid #eeeef1; page-break-inside: avoid; }
  ul.check li:last-child { border-bottom: 0; }
  .mark { width: 18px; height: 18px; border-radius: 99px; display: flex; align-items: center; justify-content: center; font-size: 10pt; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
  .mark.ok { background: #e3f4ed; color: #11805d; }
  .mark.warn { background: #fdf0da; color: #9a5b00; }
  .mark.bad { background: #fbe4e7; color: #a32233; }
  .check-title { font-weight: 600; }
  .check-detail { color: #55555f; font-size: 8.5pt; }

  .gauges { display: flex; justify-content: space-between; text-align: center; }
  .gauge { width: 19%; }
  .gauge-label { font-size: 8.5pt; color: #55555f; margin-top: 4px; }
  .legend { text-align: center; color: #8b8b96; font-size: 8pt; margin-top: 6px; }
  .legend > span { margin: 0 6px; }

  .timeline { list-style: none; margin: 0 0 0 9px; padding: 0 0 0 14px; border-left: 2px solid #eeeef1; }
  .timeline li { position: relative; padding: 0 0 10px 12px; page-break-inside: avoid; }
  .timeline li::before { content: ''; position: absolute; left: -23px; top: 5px; width: 10px; height: 10px; border-radius: 99px; background: #fff; border: 2px solid #dd364a; }
  .timeline .when { color: #8b8b96; font-size: 8pt; }
</style>
</head>
<body>
  <header>
    <div class="brand">${escapeHtml(data.brand.name)} <span>relatório mensal</span></div>
    <h1>${escapeHtml(data.site.label)}</h1>
    <p class="subtitle">${escapeHtml(data.organizationName)} · ${escapeHtml(data.site.url)} · ${escapeHtml(data.period.label)}${
      data.monitoredFrom ? ` · acompanhamento desde ${formatDate(data.monitoredFrom)}` : ''
    }</p>
    ${
      data.period.partial
        ? '<p class="subtitle muted">Relatório provisório: o mês ainda não acabou. O relatório do mês completo substitui este.</p>'
        : ''
    }
  </header>

  ${primeiraPagina(data)}

  <section class="block summary">
    ${data.summary.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
  </section>

  ${notesSection(data)}

  <div class="quebra"></div>

  ${data.sections
    .map((section) => {
      switch (section) {
        case 'disponibilidade':
          return uptimeSection(data)
        case 'seguranca':
          return findingsSection(data)
        case 'desempenho':
          return performanceSection(data)
        case 'formularios':
          return formsSection(data)
        case 'wordpress':
          return wordpressSection(data)
        case 'trabalho':
          return activitySection(data)
        case 'proximos':
          return `<section class="block">
    <h2>Próximos passos</h2>
    <ul class="recommendations">
      ${data.recommendations.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
    </ul>
  </section>`
      }
    })
    .join('\n')}

  <footer>${escapeHtml(rodape(data))}</footer>
</body>
</html>`
}
