import type { Severity } from '@jellycare/core'
import type { DashboardData } from '@/lib/dashboard'
import { Card, CardHeader, EmptyState, formatDateTime, formatRelative } from '@/components/ui'
import { UptimeStrip } from './uptime-strip'

/**
 * Como está este site, a 30 dias.
 *
 * Responde por esta ordem a três perguntas: está bem agora, esteve bem, e
 * estamos a fazer o nosso trabalho. A terceira é a que quase todas as
 * ferramentas esquecem e é a que justifica a avença.
 *
 * Os números saem do mesmo motor que gera o relatório mensal do cliente,
 * sobre uma janela deslizante em vez de um mês de calendário. Se fossem
 * calculados aqui à parte, mais cedo ou mais tarde o painel e o PDF
 * discordavam — e a discussão acontecia à frente do cliente.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'críticos',
  high: 'elevados',
  medium: 'médios',
  low: 'baixos',
  info: 'informativos',
}

function duracao(ms: number): string {
  const minutos = Math.round(ms / 60_000)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`
}

/**
 * Um número em destaque.
 *
 * O rodapé não é decoração: é onde vive a ressalva. Uma percentagem de
 * disponibilidade sem a contagem de observações em que assenta parece mais
 * firme do que é, e 99,9% sobre doze observações não é a mesma afirmação que
 * 99,9% sobre oito mil.
 */
function Tile({
  label,
  value,
  footnote,
  tone = 'neutro',
}: {
  label: string
  value: string
  footnote?: string
  tone?: 'neutro' | 'bom' | 'aviso' | 'mau'
}) {
  const cor =
    tone === 'mau'
      ? 'text-[#a32233]'
      : tone === 'aviso'
        ? 'text-[#a16207]'
        : tone === 'bom'
          ? 'text-[#15803d]'
          : 'text-ink-900'

  return (
    <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${cor}`}>{value}</p>
      {footnote ? <p className="mt-1 text-xs text-ink-400">{footnote}</p> : null}
    </div>
  )
}

export function SiteDashboard({ data }: { data: DashboardData }) {
  const { report, daily, certDaysRemaining, wordpress } = data
  const { uptime, findings, forms, activity } = report

  const abertosGraves = findings.openBySeverity.critical + findings.openBySeverity.high
  const coberturaBaixa = uptime.coverage !== null && uptime.coverage < 0.9

  const entregas =
    forms.delivered + forms.notDelivered > 0
      ? `${forms.delivered}/${forms.delivered + forms.notDelivered}`
      : '—'

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Disponibilidade, 30 dias"
          value={uptime.uptimePercent === null ? '—' : `${uptime.uptimePercent.toFixed(2)}%`}
          footnote={
            uptime.samples === 0
              ? 'Sem observações ainda'
              : `${uptime.samples} observações` +
                (coberturaBaixa
                  ? ` · cobertura ${Math.round((uptime.coverage ?? 0) * 100)}%`
                  : '') +
                (uptime.slaMet === false ? ` · abaixo do SLA de ${uptime.slaTarget}%` : '')
          }
          tone={uptime.slaMet === false ? 'mau' : uptime.uptimePercent === null ? 'neutro' : 'bom'}
        />

        <Tile
          label="Problemas em aberto"
          value={String(findings.stillOpen)}
          footnote={
            findings.stillOpen === 0
              ? 'Nada por resolver'
              : (['critical', 'high', 'medium', 'low'] as Severity[])
                  .filter((s) => findings.openBySeverity[s] > 0)
                  .map((s) => `${findings.openBySeverity[s]} ${SEVERITY_LABEL[s]}`)
                  .join(' · ')
          }
          tone={abertosGraves > 0 ? 'mau' : findings.stillOpen > 0 ? 'aviso' : 'bom'}
        />

        <Tile
          label="Entregas de formulário"
          value={entregas}
          footnote={
            forms.submissions === 0
              ? 'Nenhum teste no período'
              : `${forms.submissions} submissões` +
                (forms.landedInSpam > 0 ? ` · ${forms.landedInSpam} em spam` : '') +
                (forms.averageLatencyMs !== null
                  ? ` · ${Math.round(forms.averageLatencyMs / 1000)}s de latência`
                  : '')
          }
          tone={forms.notDelivered > 0 || forms.landedInSpam > 0 ? 'mau' : 'neutro'}
        />

        <Tile
          label="Certificado"
          value={certDaysRemaining === null ? '—' : `${certDaysRemaining} dias`}
          footnote={certDaysRemaining === null ? 'Ainda não verificado' : 'até expirar'}
          tone={
            certDaysRemaining === null
              ? 'neutro'
              : certDaysRemaining < 14
                ? 'mau'
                : certDaysRemaining < 30
                  ? 'aviso'
                  : 'bom'
          }
        />
      </div>

      <Card>
        <CardHeader title="Disponibilidade dia a dia" />
        <UptimeStrip days={daily} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Interrupções" />
          {uptime.incidents.length === 0 ? (
            <EmptyState>Nenhuma interrupção nos últimos 30 dias.</EmptyState>
          ) : (
            <ul className="divide-y divide-ink-100">
              {uptime.incidents.slice(0, 8).map((incident) => (
                <li key={incident.start.toISOString()} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-900">{formatDateTime(incident.start)}</span>
                    <span className="shrink-0 text-xs text-[#a32233]">
                      {duracao(incident.durationMs)}
                      {incident.ongoing ? ' · a decorrer' : ''}
                    </span>
                  </div>
                  {incident.reason ? (
                    <p className="mt-0.5 truncate text-xs text-ink-400">{incident.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="O que foi feito" />
          <dl className="divide-y divide-ink-100">
            {[
              ['Problemas resolvidos', String(findings.resolved)],
              ['Problemas novos', String(findings.opened)],
              ['Verificações corridas', String(activity.checksRun)],
              [
                'Verificações falhadas',
                activity.checksFailed === 0 ? 'nenhuma' : String(activity.checksFailed),
              ],
              ['Formulários testados', String(forms.submissions)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <dt className="text-ink-600">{label}</dt>
                <dd className="font-medium text-ink-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      {wordpress ? <WordPressMetrics snapshot={wordpress} /> : null}
    </div>
  )
}

/**
 * O retrato WordPress.
 *
 * Vem do inventário que a recolha diária guarda, não da API ao vivo: um
 * painel que chamasse a WP Umbrella a cada visita ficava refém do tempo de
 * resposta e do limite de pedidos deles. Por isso a data da recolha aparece
 * sempre — dados de ontem apresentados como se fossem de agora são pior do
 * que não os ter.
 */
function WordPressMetrics({ snapshot }: { snapshot: NonNullable<DashboardData['wordpress']> }) {
  const vulns = snapshot.vulnerabilities
  const totalVulns = vulns.critical + vulns.high + vulns.medium + vulns.low

  return (
    <Card>
      <CardHeader title="WordPress" />

      <div className="grid gap-4 border-b border-ink-200 px-5 py-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-ink-500">Atualizações pendentes</p>
          <p
            className={`mt-1 text-2xl font-semibold tracking-tight ${
              snapshot.updatesPending > 0 ? 'text-[#a16207]' : 'text-[#15803d]'
            }`}
          >
            {snapshot.updatesPending}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            em {snapshot.plugins} plugins e {snapshot.themes} temas
          </p>
        </div>

        <div>
          <p className="text-xs text-ink-500">Vulnerabilidades conhecidas</p>
          <p
            className={`mt-1 text-2xl font-semibold tracking-tight ${
              vulns.critical + vulns.high > 0
                ? 'text-[#a32233]'
                : totalVulns > 0
                  ? 'text-[#a16207]'
                  : 'text-[#15803d]'
            }`}
          >
            {totalVulns}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            {totalVulns === 0
              ? 'Nenhuma em aberto'
              : [
                  vulns.critical > 0 ? `${vulns.critical} críticas` : null,
                  vulns.high > 0 ? `${vulns.high} elevadas` : null,
                  vulns.medium > 0 ? `${vulns.medium} médias` : null,
                  vulns.low > 0 ? `${vulns.low} baixas` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </p>
        </div>

        <div>
          <p className="text-xs text-ink-500">Última recolha</p>
          <p className="mt-1 text-sm text-ink-900">
            {snapshot.lastError
              ? 'falhou'
              : snapshot.lastSyncAt
                ? formatRelative(snapshot.lastSyncAt)
                : 'ainda não houve'}
          </p>
          <p className="mt-1 truncate text-xs text-ink-400">
            {snapshot.lastError ?? snapshot.projectName ?? 'WP Umbrella'}
          </p>
        </div>
      </div>

      {snapshot.outdated.length > 0 ? (
        <ul className="divide-y divide-ink-100">
          {snapshot.outdated.slice(0, 10).map((component) => (
            <li
              key={`${component.kind}:${component.name}`}
              className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
            >
              <span className="min-w-0 truncate text-ink-900">
                {component.name}
                {component.kind === 'theme' ? (
                  <span className="ml-1.5 text-xs text-ink-400">tema</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-[#a16207]">
                {component.from ?? '?'} → {component.to}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}
