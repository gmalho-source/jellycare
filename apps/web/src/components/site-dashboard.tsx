import type { Severity } from '@jellycare/core'
import type { DashboardData } from '@/lib/dashboard'
import {
  Card,
  CardHeader,
  EmptyState,
  formatDateTime,
  formatRelative,
  formatUptime,
} from '@/components/ui'
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
 *
 * O mesmo componente serve o painel interno e o portal do cliente, com a
 * audiência a decidir o que se mostra. Uma segunda versão para o portal era
 * a via rápida e a errada: ao fim de duas alterações os dois painéis diziam
 * números diferentes sobre o mesmo site, e é o cliente que descobre.
 *
 * O que a audiência `cliente` esconde não é informação sobre o site dele —
 * é informação sobre nós. Uma verificação nossa que falhou, o nome do
 * fornecedor de onde vem o inventário, o erro que ele devolveu: isso é
 * matéria de operação, e é a mesma regra que já esconde a cobertura reduzida
 * do portal.
 */

export type Audiencia = 'equipa' | 'cliente' 

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
      ? 'text-mau'
      : tone === 'aviso'
        ? 'text-medio'
        : tone === 'bom'
          ? 'text-bom'
          : 'text-ink-900'

  return (
    <div className="flex flex-col gap-1.5 rounded-2xl bg-white px-5 py-4 shadow-card">
      <span className="text-xs font-medium text-ink-400">{label}</span>
      <span className={`font-display text-3xl font-semibold tracking-tight tabular-nums ${cor}`}>
        {value}
      </span>
      {footnote ? <span className="text-xs text-ink-400">{footnote}</span> : null}
    </div>
  )
}

function tamanho(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1).replace('.', ',')} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

/**
 * O painel inteiro, numa página só.
 *
 * É o que o portal do cliente usa: ali não há navegação por secções, e
 * partir isto em separadores obrigava um cliente com um site a andar aos
 * cliques para ver o que cabe num ecrã.
 *
 * O painel interno compõe as mesmas peças à sua maneira, secção a secção —
 * as peças são as mesmas, e é isso que impede as duas vistas de divergirem.
 */
export function SiteDashboard({
  data,
  audiencia = 'equipa',
}: {
  data: DashboardData
  audiencia?: Audiencia
}) {
  return (
    <>
      <DashboardOverview data={data} audiencia={audiencia} />
      {data.backups ? <BackupMetrics snapshot={data.backups} /> : null}
      {data.wordpress ? (
        <WordPressMetrics snapshot={data.wordpress} interno={audiencia === 'equipa'} />
      ) : null}
    </>
  )
}

export function DashboardOverview({
  data,
  audiencia = 'equipa',
}: {
  data: DashboardData
  audiencia?: Audiencia
}) {
  const { report, daily, certDaysRemaining } = data
  const interno = audiencia === 'equipa' 
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
          value={formatUptime(uptime.uptimePercent)}
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
                    <span className="shrink-0 text-xs text-mau">
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
              // Uma verificação que falhou é falha nossa, não do site. Conta
              // para a equipa saber que tem trabalho; ao cliente diria que o
              // número acima não é bem o que parece, sem lhe dar nada com que
              // agir.
              ...(interno
                ? [
                    [
                      'Verificações falhadas',
                      activity.checksFailed === 0 ? 'nenhuma' : String(activity.checksFailed),
                    ] as const,
                  ]
                : []),
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
export function WordPressMetrics({
  snapshot,
  interno,
}: {
  snapshot: NonNullable<DashboardData['wordpress']>
  interno: boolean
}) {
  const vulns = snapshot.vulnerabilities
  const totalVulns = vulns.critical + vulns.high + vulns.medium + vulns.low

  return (
    <Card>
      <CardHeader title="WordPress" />

      <div className="grid gap-4 border-b border-ink-100 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-ink-400">Versão do WordPress</p>
          <p
            className={`mt-1 font-display text-2xl font-semibold tracking-tight ${
              snapshot.core === null
                ? 'text-ink-400'
                : snapshot.core.latestVersion !== null
                  ? 'text-mau'
                  : 'text-bom'
            }`}
          >
            {snapshot.core?.version ?? '—'}
          </p>
          {/* Vermelho e não amarelo: as explorações automáticas procuram
              versões conhecidas do core em massa, e é por isso que esta
              atualização não espera pelo ciclo das outras. */}
          <p className="mt-1 text-xs text-ink-400">
            {snapshot.core === null
              ? 'Ainda por determinar'
              : snapshot.core.latestVersion !== null
                ? `Desatualizado — a atual é a ${snapshot.core.latestVersion}`
                : 'Na versão atual'}
          </p>
        </div>

        <div>
          <p className="text-xs text-ink-400">Atualizações pendentes</p>
          <p
            className={`mt-1 font-display text-2xl font-semibold tracking-tight ${
              snapshot.updatesPending > 0 ? 'text-medio' : 'text-bom'
            }`}
          >
            {snapshot.updatesPending}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            em {snapshot.plugins} plugins e {snapshot.themes} temas
          </p>
        </div>

        <div>
          <p className="text-xs text-ink-400">Vulnerabilidades conhecidas</p>
          <p
            className={`mt-1 font-display text-2xl font-semibold tracking-tight ${
              vulns.critical + vulns.high > 0
                ? 'text-mau'
                : totalVulns > 0
                  ? 'text-medio'
                  : 'text-bom'
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
          <p className="text-xs text-ink-400">Última recolha</p>
          <p className="mt-1 text-sm text-ink-900">
            {snapshot.lastError
              ? 'falhou'
              : snapshot.lastSyncAt
                ? formatRelative(snapshot.lastSyncAt)
                : 'ainda não houve'}
          </p>
          {/* O cliente vê que os números podem estar desatualizados, que é o
              que lhe importa para os ler. Não vê o nome do fornecedor nem a
              mensagem de erro dele: é uma avaria nossa, e um erro de API em
              bruto no portal só serve para o preocupar com o que não pode
              resolver. */}
          <p className="mt-1 truncate text-xs text-ink-400">
            {interno
              ? (snapshot.lastError ?? snapshot.projectName ?? 'WP Umbrella')
              : snapshot.lastError
                ? 'Estamos a tratar disso — os números abaixo podem estar desatualizados.'
                : 'Recolhido automaticamente.'}
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
              <span className="shrink-0 text-xs text-medio">
                {component.from ?? '?'} → {component.to}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

/**
 * As cópias de segurança.
 *
 * Cartão próprio e não uma linha dentro do WordPress: é a pergunta que se faz
 * antes de tocar num site e no dia em que ele parte, e merece ser lida de
 * relance. Vale igual para a equipa e para o cliente — não há aqui nada que
 * seja informação sobre nós.
 *
 * A ferramenta que as executa não é nomeada. Para quem lê, a cópia é parte do
 * serviço; o fornecedor por detrás é uma escolha nossa, que pode mudar sem
 * que a promessa mude.
 */
export function BackupMetrics({ snapshot }: { snapshot: NonNullable<DashboardData['backups']> }) {
  const semCopia = snapshot.lastGoodAt === null

  return (
    <Card>
      <CardHeader title="Cópias de segurança" />

      <div className="grid gap-4 border-b border-ink-100 px-5 py-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-ink-400">Última cópia concluída</p>
          <p
            className={`mt-1 font-display text-2xl font-semibold tracking-tight ${
              semCopia ? 'text-mau' : 'text-bom'
            }`}
          >
            {semCopia ? 'nenhuma' : formatRelative(snapshot.lastGoodAt)}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            {semCopia
              ? 'Não há por onde reverter uma avaria.'
              : `${tamanho(snapshot.sizeBytes)} · ${formatDateTime(snapshot.lastGoodAt)}`}
          </p>
        </div>

        <div>
          <p className="text-xs text-ink-400">Cópias registadas</p>
          <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900">
            {snapshot.total}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            {snapshot.failed === 0
              ? 'Nenhuma falhou'
              : `${snapshot.failed} ${snapshot.failed === 1 ? 'falhou' : 'falharam'}`}
          </p>
        </div>

        <div>
          <p className="text-xs text-ink-400">Versão do WordPress</p>
          <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900">
            {snapshot.wordpressVersion ?? '—'}
          </p>
          <p className="mt-1 text-xs text-ink-400">na última cópia</p>
        </div>
      </div>

      <ul className="divide-y divide-ink-100">
        {snapshot.recent.map((copia) => (
          <li
            key={copia.startedAt.toISOString()}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:gap-4 sm:px-5"
          >
            <span className="min-w-0 text-ink-900">{formatDateTime(copia.startedAt)}</span>

            <span className="justify-self-end text-xs tabular-nums text-ink-400 sm:justify-self-start">
              {tamanho(copia.sizeBytes)}
            </span>

            <span
              className={
                copia.status === 'FINISHED'
                  ? 'sev-ok col-span-2 justify-self-start whitespace-nowrap rounded-full px-2 py-0.5 text-xs sm:col-span-1 sm:justify-self-end'
                  : copia.status === 'PENDING'
                    ? 'sev-info col-span-2 justify-self-start whitespace-nowrap rounded-full px-2 py-0.5 text-xs sm:col-span-1 sm:justify-self-end'
                    : 'sev-high col-span-2 justify-self-start whitespace-nowrap rounded-full px-2 py-0.5 text-xs sm:col-span-1 sm:justify-self-end'
              }
            >
              {copia.status === 'FINISHED'
                ? 'concluída'
                : copia.status === 'PENDING'
                  ? 'a decorrer'
                  : `falhou${copia.errorCode ? ` · ${copia.errorCode}` : ''}`}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
