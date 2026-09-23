import { notFound } from 'next/navigation'
import { Card, CardHeader, formatRelative } from '@/components/ui'
import { PageSpeedPanel } from '@/components/page-speed-panel'
import { ResponseTimeChart } from '@/components/response-time-chart'
import {
  SeletorDispositivo,
  tipoDeVelocidade,
  vistaDe,
} from '@/components/vista-dispositivo'
import { getPageSpeedHistory, getResponseTimes, getSiteHeader } from '@/lib/queries'
import { assertMembership, requireUser } from '@/lib/session'
import { AnalisePanel } from '../analise-panel'

export const dynamic = 'force-dynamic'

export default async function DesempenhoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ vista?: string | string[] }>
}) {
  const { id } = await params
  const user = await requireUser()

  const header = await getSiteHeader(id)
  if (!header) notFound()
  assertMembership(user, header.site.organizationId)

  const vista = vistaDe((await searchParams).vista)

  // Duas coisas diferentes com o mesmo nome no dia a dia: a velocidade é o
  // tempo que a página leva a ficar utilizável para quem a abre; o tempo de
  // resposta é o que o servidor demora a dizer a primeira palavra. Um site
  // pode ter o segundo excelente e o primeiro péssimo.
  const [velocidade, dias] = await Promise.all([
    getPageSpeedHistory(id, tipoDeVelocidade(vista)),
    getResponseTimes(id),
  ])

  return (
    <>
      <Card>
        <CardHeader
          title="Velocidade das páginas"
          action={
            <span className="flex flex-wrap items-center justify-end gap-2">
              <SeletorDispositivo base={`/sites/${id}/desempenho`} vista={vista} />
              <AnalisePanel siteId={id} />
            </span>
          }
        />
        <PageSpeedPanel history={velocidade} vista={vista} />
        <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-400">
          {velocidade.latest
            ? `Última medição ${formatRelative(velocidade.latest.measuredAt)} · medido pela PageSpeed Insights, uma vez por dia.`
            : 'A primeira medição aparece aqui depois da próxima passagem diária.'}
        </p>
      </Card>

      <Card>
        <CardHeader
          title="Tempo de resposta do servidor"
          action={<span className="text-xs text-ink-400">Últimos 30 dias</span>}
        />
        <ResponseTimeChart days={dias} />
      </Card>
    </>
  )
}
