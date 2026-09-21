import { buildChallenge } from '@jellycare/checks'
import { notFound } from 'next/navigation'
import {
  Card,
  CardHeader,
  EmptyState,
  SeverityBadge,
  formatDateTime,
  formatRelative,
} from '@/components/ui'
import {
  latestReportRequest,
  listMembers,
  organizationObjections,
  MAX_FORM_TEST_URLS,
} from '@jellycare/db'
import { getDb } from '@/lib/db'
import { checkMeta } from '@/lib/checks'
import { getSiteDashboard } from '@/lib/dashboard'
import { getLegalState } from '@/lib/legal'
import { getPendingVerification, getSiteDetail } from '@/lib/queries'
import { listUmbrellaProjects } from '@/lib/umbrella'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { updateFindingState } from '../../actions'
import { AccessPanel } from './access-panel'
import { FormUrlsPanel } from './form-urls-panel'
import { SiteDashboard } from '@/components/site-dashboard'
import { LegalPanel } from './legal-panel'
import { SettingsPanel } from './settings-panel'
import { WordPressPanel } from './wordpress-panel'
import { ReportPanel } from './report-panel'
import { VerificationPanel } from './verification-panel'

export const dynamic = 'force-dynamic'

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()

  assertMembership(user, detail.site.organizationId)
  const manageable = canManage(user, detail.site.organizationId)
  const members = await listMembers(getDb(), detail.site.organizationId)
  const lastRequest = await latestReportRequest(getDb(), detail.site.id)
  // Estado legal da organização, não do site. Fica ao lado dos acessos, que
  // são a outra coisa desta página que pertence à organização e não ao site.
  const legal = await getLegalState(detail.site.organizationId)
  const objecoes = await organizationObjections(getDb(), detail.site.organizationId)
  // A lista de projetos só é precisa para quem pode configurar. Quem não pode
  // não vê o seletor, e não vale um pedido a um terceiro por cada visita.
  const umbrella = manageable
    ? await listUmbrellaProjects()
    : { projects: [], unavailable: undefined }
  // Só depois de verificado. Antes disso só há disponibilidade, e um painel
  // de métricas com tudo a zero diz menos do que o aviso que está no lugar.
  const dashboard = detail.verified ? await getSiteDashboard(id) : null

  const verification = detail.verified ? null : await getPendingVerification(id)
  // As duas vias, com o mesmo token. A que foi escolhida na criação aparece
  // primeiro; a outra fica disponível sem ninguém ter de trocar nada, porque
  // a verificação aceita qualquer uma das duas.
  const challenge =
    verification && !detail.verified
      ? buildChallenge(verification.method, detail.site.hostname, verification.token)
      : null
  const alternative =
    verification && !detail.verified
      ? buildChallenge(
          verification.method === 'dns_txt' ? 'http_file' : 'dns_txt',
          detail.site.hostname,
          verification.token,
        )
      : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{detail.site.label}</h1>
        <a
          href={detail.site.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-block text-sm text-ink-600 hover:text-jelly-500"
        >
          {detail.site.url}
        </a>
      </div>

      {challenge && (
        <VerificationPanel
          siteId={detail.site.id}
          challenge={challenge}
          alternative={alternative!}
          canManage={manageable}
        />
      )}

      {dashboard ? <SiteDashboard data={dashboard} /> : null}

      <Card>
        <CardHeader
          title={`Problemas abertos (${detail.findings.length})`}
          action={
            detail.findings.length > 0 ? (
              <span className="text-xs text-ink-400">Mais graves primeiro</span>
            ) : undefined
          }
        />
        {detail.findings.length === 0 ? (
          <EmptyState>Nenhum problema aberto neste site.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink-100">
            {detail.findings.map((finding) => (
              <li key={finding.id} className="px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={finding.severity} />
                      <span className="font-medium text-ink-900">{finding.title}</span>
                      {finding.state === 'acknowledged' && (
                        <span className="text-xs text-ink-400">reconhecido</span>
                      )}
                    </div>

                    {finding.discriminator && (
                      <p className="mt-1 truncate text-xs text-ink-400">
                        {finding.discriminator}
                      </p>
                    )}
                    {finding.detail && (
                      <p className="mt-2 text-sm text-ink-600">{finding.detail}</p>
                    )}

                    <p className="mt-2 text-xs text-ink-400">
                      Detetado {formatRelative(finding.firstSeenAt)} · visto pela última vez{' '}
                      {formatRelative(finding.lastSeenAt)} · {finding.occurrences}{' '}
                      {finding.occurrences === 1 ? 'observação' : 'observações'}
                    </p>
                  </div>

                  {manageable && (
                    <div className="flex shrink-0 gap-2">
                      {finding.state !== 'acknowledged' && (
                        <form action={updateFindingState}>
                          <input type="hidden" name="findingId" value={finding.id} />
                          <input type="hidden" name="state" value="acknowledged" />
                          <button
                            type="submit"
                            className="rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
                          >
                            Reconhecer
                          </button>
                        </form>
                      )}
                      <form action={updateFindingState}>
                        <input type="hidden" name="findingId" value={finding.id} />
                        <input type="hidden" name="state" value="ignored" />
                        <button
                          type="submit"
                          className="rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
                          title="Deixa de notificar e de aparecer, mesmo que se agrave"
                        >
                          Silenciar
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Verificações" />
          <ul className="divide-y divide-ink-100">
            {detail.checks.map((check) => {
              const registered = checkMeta(check.checkType)
              const blocked = !detail.verified && registered?.access === 'verified'
              return (
                <li
                  key={check.id}
                  data-check-row={check.checkType}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <div>
                    <span className="text-ink-900">{registered?.label ?? check.checkType}</span>
                    <span className="mt-0.5 block text-xs text-ink-400">
                      {blocked
                        ? 'Aguarda verificação do domínio'
                        : check.enabled
                          ? `A cada ${formatInterval(check.intervalMinutes)}`
                          : 'Desativada'}
                    </span>
                  </div>
                  <span className="text-xs text-ink-400">
                    {check.lastRunAt ? formatRelative(check.lastRunAt) : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Formulários" />
          {detail.forms.length === 0 ? (
            <EmptyState>
              Nenhum formulário descoberto ainda. São detetados durante a análise do site.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-ink-100">
              {detail.forms.map((form) => (
                <li key={form.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-900">{form.label}</span>
                    <span className="shrink-0 text-xs text-ink-400">
                      {form.excluded
                        ? 'Não submetido'
                        : form.enabled
                          ? 'Em teste'
                          : 'Página não declarada'}
                    </span>
                  </div>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {form.pageUrl}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <FormUrlsPanel
            siteId={detail.site.id}
            urls={detail.site.formTestUrls}
            maxUrls={MAX_FORM_TEST_URLS}
            suggestions={[
              ...new Set(
                detail.forms.filter((form) => !form.excluded).map((form) => form.pageUrl),
              ),
            ]}
            canManage={manageable}
          />
        </Card>

        <Card>
          <CardHeader title="WordPress" />
          <WordPressPanel
            siteId={detail.site.id}
            linked={
              detail.connector
                ? {
                    externalId: detail.connector.externalId,
                    externalName: detail.connector.externalName,
                  }
                : null
            }
            lastSyncAt={detail.connector?.lastSyncAt ?? null}
            lastError={detail.connector?.lastError ?? null}
            options={umbrella.projects.map((project) => ({
              id: project.id,
              name: project.name,
              baseUrl: project.baseUrl,
              connectivity: project.connectivity,
            }))}
            {...(umbrella.unavailable ? { unavailable: umbrella.unavailable } : {})}
            components={detail.wpComponents.map((component) => ({
              kind: component.kind,
              key: component.key,
              name: component.name,
              version: component.version,
              latestVersion: component.latestVersion,
              active: component.active,
            }))}
            canManage={manageable}
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Relatórios mensais"
          action={
            detail.reports.length > 0 ? (
              <span className="text-xs text-ink-400">Enviados ao cliente</span>
            ) : undefined
          }
        />
        {detail.reports.length === 0 ? (
          <EmptyState>
            Ainda não há relatórios. O primeiro é gerado no início do mês seguinte.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-ink-100">
            {detail.reports.map((report) => (
              <li key={report.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <a
                    href={`/api/reports/${report.id}`}
                    className="text-sm font-medium text-ink-900 hover:text-jelly-500"
                  >
                    {MONTHS[report.periodMonth - 1]} de {report.periodYear}
                  </a>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {report.highlights.summary[0] ?? ''}
                  </span>
                </div>
                <div className="shrink-0 pl-4 text-right">
                  <span className="block text-xs text-ink-400">
                    {report.sentAt
                      ? `Enviado ${formatRelative(report.sentAt)}`
                      : 'Por enviar'}
                  </span>
                  {report.highlights.uptimePercent !== null && (
                    <span className="block text-xs tabular-nums text-ink-600">
                      {report.highlights.uptimePercent.toFixed(2).replace('.', ',')}% disponível
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {manageable ? (
          <ReportPanel
            siteId={detail.site.id}
            configuredRecipients={detail.site.reportRecipients}
            lastRequest={lastRequest}
          />
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Execuções recentes" />
        {detail.runs.length === 0 ? (
          <EmptyState>Ainda não correu nenhuma verificação.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink-100">
            {/* Cinco colunas de tabela não cabem em 390px: era isto que
                rebentava a página no telemóvel. A mesma grelha empilha em
                duas linhas no pequeno e alinha nas cinco colunas a partir de
                `sm`. */}
            {detail.runs.map((run) => {
              const motivo = run.error ?? run.warnings.join(' · ')

              return (
                <li
                  key={run.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[minmax(7rem,1fr)_9.5rem_minmax(0,2fr)_5rem_7rem] sm:gap-4 sm:px-5 sm:py-2.5"
                >
                  <span className="min-w-0 truncate text-ink-900">
                    {checkMeta(run.checkType)?.label ?? run.checkType}
                  </span>

                  <span className="justify-self-end sm:justify-self-start">
                    <span
                      className={
                        run.status !== 'ok'
                          ? 'sev-high whitespace-nowrap rounded-full px-2 py-0.5 text-xs'
                          : run.warnings.length > 0
                            ? 'sev-medium whitespace-nowrap rounded-full px-2 py-0.5 text-xs'
                            : 'sev-ok whitespace-nowrap rounded-full px-2 py-0.5 text-xs'
                      }
                    >
                      {run.status !== 'ok'
                        ? 'Falhou'
                        : run.warnings.length > 0
                          ? 'Cobertura reduzida'
                          : 'Concluída'}
                    </span>
                  </span>

                  {/* Os avisos só aparecem aqui: dizem respeito à plataforma e
                      não ao site, por isso nunca chegam ao portal do cliente
                      nem ao relatório mensal.

                      Limitado a três linhas. Um erro de API traz a resposta
                      inteira do fornecedor — a do Safe Browsing ocupava meio
                      ecrã de telemóvel e empurrava tudo o resto para baixo. O
                      texto completo fica no `title` e nos registos. */}
                  <p
                    title={motivo}
                    className={`col-span-2 line-clamp-3 min-w-0 break-words text-xs text-ink-400 sm:col-span-1 ${
                      // Sem motivo não há nada a mostrar no telemóvel, mas a
                      // célula tem de continuar a existir no grande: uma
                      // coluna a menos numa linha desalinha a grelha inteira.
                      motivo ? '' : 'hidden sm:block'
                    }`}
                  >
                    {motivo}
                  </p>

                  <span className="col-span-2 flex items-center gap-1.5 text-xs text-ink-400 sm:contents">
                    <span className="tabular-nums sm:text-right">{run.durationMs} ms</span>
                    <span aria-hidden className="sm:hidden">
                      ·
                    </span>
                    <span className="sm:text-right">{formatDateTime(run.startedAt)}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {manageable ? (
        <Card>
          <CardHeader title="Definições" />
          <SettingsPanel
            siteId={detail.site.id}
            label={detail.site.label}
            url={detail.site.url}
            state={detail.site.state}
            expectedContent={detail.site.expectedContent}
            recipients={detail.site.reportRecipients}
            slaTarget={detail.site.slaTarget}
          />
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Tratamento de dados" />
        <LegalPanel
          organizationId={detail.site.organizationId}
          negotiatedRef={legal.negotiatedRef}
          aceites={legal.accepted.map((aceite) => ({
            title: aceite.title,
            version: aceite.version,
            acceptedAt: aceite.acceptedAt,
            representedBy: aceite.representedBy,
          }))}
          emFalta={legal.missing.map((documento) => ({
            title: documento.title,
            version: documento.version,
          }))}
          oposicoes={objecoes.map((oposicao) => ({
            id: oposicao.id,
            reason: oposicao.reason,
            createdAt: oposicao.createdAt,
            documentTitle: oposicao.documentTitle,
          }))}
          canManage={manageable}
        />
      </Card>

      <AccessPanel
        organizationId={detail.site.organizationId}
        members={members}
        currentUserId={user.id}
        canManage={manageable}
      />
    </div>
  )
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`
  const days = Math.round(minutes / (60 * 24))
  return days === 1 ? 'dia' : days === 7 ? 'semana' : `${days} dias`
}
