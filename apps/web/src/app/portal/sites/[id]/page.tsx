import { explicacaoDe } from '@jellycare/core'
import { notFound } from 'next/navigation'
import {
  Card,
  CardHeader,
  EmptyState,
  SeverityBadge,
  formatRelative,
  formatUptime,
} from '@/components/ui'
import { EstadoDoSite } from '@/components/estado-do-site'
import { SiteDashboard } from '@/components/site-dashboard'
import { checkMeta } from '@/lib/checks'
import { getSiteDashboard } from '@/lib/dashboard'
import { lerDesempenho, lerSeguranca } from '@/lib/estado-do-site'
import { getPageSpeedHistory, getSiteDetail, getUptime } from '@/lib/queries'
import { assertMembership, requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * O site visto pelo cliente.
 *
 * As mesmas verdades do painel interno, ditas de outra maneira e sem o que só
 * interessa a quem opera: configuração, periodicidades, tokens, seletores.
 * Nada aqui é escrita — o cliente lê e descarrega, não altera.
 *
 * O painel de métricas é literalmente o mesmo componente do lado interno, com
 * a audiência em `cliente`. É o que se paga: a disponibilidade dia a dia, as
 * interrupções, o que foi feito no período e o estado do WordPress. Escondê-lo
 * de quem paga a avença, e mostrá-lo só a quem a cobra, era ao contrário.
 */
export default async function PortalSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()
  assertMembership(user, detail.site.organizationId)

  // Só depois de verificado, tal como no painel interno: antes disso não há
  // verificações de segurança nem inventário, e um painel a zeros diria menos
  // do que a frase que fica no lugar.
  const [dashboard, velocidade] = await Promise.all([
    detail.verified ? getSiteDashboard(id) : null,
    getPageSpeedHistory(id, 'page_speed'),
  ])
  // Sem painel, ainda assim há disponibilidade para mostrar — é o que
  // monitorizamos desde o primeiro dia.
  const uptime = dashboard ? null : await getUptime(id, 30)

  const abertos = detail.findings
  const formulariosTestados = detail.forms.filter((form) => form.enabled && !form.excluded)

  return (
    <>
      <EstadoDoSite
        seguranca={lerSeguranca(detail.findings, detail.verified)}
        desempenho={lerDesempenho(velocidade.latest?.score ?? null)}
        hrefSeguranca="#problemas"
        hrefDesempenho={`/portal/sites/${id}/desempenho`}
      />

      {dashboard ? <SiteDashboard data={dashboard} audiencia="cliente" /> : null}

      {/* Exatamente um dos dois existe: ou há painel, ou há a leitura simples
          de disponibilidade que o antecede. */}
      {uptime ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-5">
            <p className="text-xs text-ink-400">Disponível (30 dias)</p>
            <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900">
              {formatUptime(uptime.percentage)}
            </p>
            <p className="mt-1 text-xs text-ink-400">
              {uptime.samples === 0
                ? 'Ainda sem observações suficientes.'
                : uptime.down === 0
                  ? `${uptime.samples} observações, nenhuma falha.`
                  : `${uptime.samples} observações, ${uptime.down} com o site inacessível.`}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-xs text-ink-400">Última verificação</p>
            <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900">
              {formatRelative(detail.runs[0]?.startedAt)}
            </p>
            <p className="mt-1 text-xs text-ink-400">
              {detail.checks.length} verificações a correr automaticamente.
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-xs text-ink-400">Formulários vigiados</p>
            <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900">
              {formulariosTestados.length}
            </p>
            <p className="mt-1 text-xs text-ink-400">
              {formulariosTestados.length === 0
                ? 'Nenhum formulário de contacto em teste.'
                : 'Preenchidos e submetidos periodicamente, como um visitante.'}
            </p>
          </Card>
        </div>
      ) : null}

      <Card id="problemas" className="scroll-mt-6">
        <CardHeader title="O que encontrámos" />
        {abertos.length === 0 ? (
          <EmptyState>
            Nada em aberto. Continuamos a verificar — se algo mudar, é avisado.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-ink-100">
            {abertos.map((finding) => {
              // O texto técnico é o que a equipa precisa de ler; a explicação
              // é o que o cliente precisa. Quando há explicação escrita para
              // este código, é ela que manda — o título técnico não chega a
              // aparecer. A alternativa, mostrar os dois, obrigava o cliente a
              // decidir em qual acreditar.
              const explicacao = explicacaoDe(finding.code)
              return (
                <li key={finding.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="font-medium text-ink-900">
                      {explicacao?.titulo ?? finding.title}
                    </p>
                    <SeverityBadge severity={finding.severity} />
                  </div>

                  <p className="mt-1.5 text-sm text-ink-600">
                    {explicacao?.oQueE ?? finding.detail}
                  </p>

                  {explicacao ? (
                    <dl className="mt-3 space-y-2 border-l-2 border-ink-100 pl-3.5 text-sm">
                      <div>
                        <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-400">
                          Porque importa
                        </dt>
                        <dd className="mt-0.5 text-ink-600">{explicacao.porqueImporta}</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-400">
                          O que fazemos
                        </dt>
                        <dd className="mt-0.5 text-ink-600">{explicacao.oQueFazemos}</dd>
                      </div>
                    </dl>
                  ) : null}

                  <p className="mt-3 text-xs text-ink-400">
                    Detetado {formatRelative(finding.firstSeenAt)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="O que vigiamos neste site" />
        <ul className="grid gap-x-6 gap-y-2 px-5 py-4 text-sm sm:grid-cols-2">
          {detail.checks.map((check) => (
            <li key={check.id} className="flex items-center justify-between gap-3">
              <span className="text-ink-600">
                {checkMeta(check.checkType)?.label ?? check.checkType}
              </span>
              <span className="text-xs text-ink-400">{check.enabled ? 'ativa' : 'desligada'}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
