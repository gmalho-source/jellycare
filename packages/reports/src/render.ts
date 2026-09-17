import type { Severity } from '@jellycare/core'
import type { ReportData } from './build.js'
import { formatDuration, formatPercent } from './build.js'

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
  security_headers: 'Headers de segurança',
  exposed_files: 'Ficheiros expostos',
  reputation: 'Reputação e blacklists',
  broken_links: 'Links quebrados',
  form_discovery: 'Descoberta de formulários',
  form_test: 'Teste de formulários',
  form_delivery: 'Entrega das notificações',
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
      ? `<span class="muted">Cobertura de ${formatPercent((uptime.coverage ?? 0) * 100)} do período — valor indicativo</span>`
      : uptime.slaMet
        ? `<span class="ok">Objetivo de ${formatPercent(uptime.slaTarget)} cumprido</span>`
        : `<span class="bad">Abaixo do objetivo de ${formatPercent(uptime.slaTarget)}</span>`

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
    <div class="metrics">
      <div class="metric">
        <span class="metric-value">${formatPercent(uptime.uptimePercent)}</span>
        <span class="metric-label">Disponibilidade</span>
      </div>
      <div class="metric">
        <span class="metric-value">${uptime.incidents.length}</span>
        <span class="metric-label">${uptime.incidents.length === 1 ? 'Interrupção' : 'Interrupções'}</span>
      </div>
      <div class="metric">
        <span class="metric-value">${formatDuration(uptime.totalDowntimeMs)}</span>
        <span class="metric-label">Tempo indisponível</span>
      </div>
      <div class="metric">
        <span class="metric-value">${
          uptime.averageResponseTimeMs === null
            ? '—'
            : `${Math.round(uptime.averageResponseTimeMs)} ms`
        }</span>
        <span class="metric-label">Resposta média</span>
      </div>
    </div>
    <p class="sla">${slaLine}</p>
    ${incidents}
  </section>`
}

function findingsSection(data: ReportData): string {
  const { findings } = data

  const counts = (['critical', 'high', 'medium', 'low'] as const)
    .filter((severity) => findings.openBySeverity[severity] > 0)
    .map(
      (severity) =>
        `<li>${severityPill(severity)} <strong>${findings.openBySeverity[severity]}</strong></li>`,
    )
    .join('')

  const highlights =
    findings.highlights.length === 0
      ? '<p class="empty">Nenhum problema em aberto no fim do período.</p>'
      : `<ul class="findings">
          ${findings.highlights
            .map(
              (finding) => `<li>
                <div class="finding-head">${severityPill(finding.severity)}<strong>${escapeHtml(
                  finding.title,
                )}</strong></div>
                ${finding.discriminator ? `<div class="mono">${escapeHtml(finding.discriminator)}</div>` : ''}
                ${finding.detail ? `<p>${escapeHtml(finding.detail)}</p>` : ''}
                <div class="muted">Detetado em ${formatDate(finding.firstSeenAt)}</div>
              </li>`,
            )
            .join('')}
        </ul>`

  const resolved =
    findings.resolvedHighlights.length === 0
      ? ''
      : `<h3>Corrigido durante o mês</h3>
         <ul class="resolved">
           ${findings.resolvedHighlights
             .map(
               (finding) =>
                 `<li>${severityPill(finding.severity)} ${escapeHtml(finding.title)}</li>`,
             )
             .join('')}
         </ul>`

  return `<section class="block">
    <h2>Segurança e qualidade</h2>
    <div class="metrics">
      <div class="metric">
        <span class="metric-value">${findings.opened}</span>
        <span class="metric-label">Detetados no mês</span>
      </div>
      <div class="metric">
        <span class="metric-value">${findings.resolved}</span>
        <span class="metric-label">Corrigidos</span>
      </div>
      <div class="metric">
        <span class="metric-value">${findings.stillOpen}</span>
        <span class="metric-label">Em aberto</span>
      </div>
    </div>
    ${counts ? `<ul class="severity-counts">${counts}</ul>` : ''}
    ${highlights}
    ${resolved}
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

function activitySection(data: ReportData): string {
  const { activity } = data
  if (activity.checksRun === 0) return ''

  return `<section class="block">
    <h2>Trabalho de monitorização</h2>
    <p class="note">
      Foram executadas <strong>${activity.checksRun}</strong> verificações automáticas durante o
      mês.
    </p>
    <table>
      <thead><tr><th>Verificação</th><th class="right">Execuções</th></tr></thead>
      <tbody>
        ${activity.byType
          .map(
            (entry) => `<tr>
              <td>${escapeHtml(CHECK_LABEL[entry.checkType] ?? entry.checkType)}</td>
              <td class="right">${entry.runs}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </section>`
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
</style>
</head>
<body>
  <header>
    <div class="brand">${escapeHtml(data.brand.name)} <span>relatório mensal</span></div>
    <h1>${escapeHtml(data.site.label)}</h1>
    <p class="subtitle">${escapeHtml(data.organizationName)} · ${escapeHtml(data.site.url)} · ${escapeHtml(data.period.label)}</p>
  </header>

  <section class="block summary">
    ${data.summary.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
  </section>

  ${uptimeSection(data)}
  ${findingsSection(data)}
  ${formsSection(data)}
  ${activitySection(data)}

  <section class="block">
    <h2>Próximos passos</h2>
    <ul class="recommendations">
      ${data.recommendations.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
    </ul>
  </section>

  <footer>
    Relatório gerado automaticamente por ${escapeHtml(data.brand.name)} em
    ${formatDate(data.generatedAt)} · ${escapeHtml(data.brand.url)}
  </footer>
</body>
</html>`
}
