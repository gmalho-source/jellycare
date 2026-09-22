import { notFound } from 'next/navigation'
import { Card, CardHeader } from '@/components/ui'
import { PageSpeedPanel } from '@/components/page-speed-panel'
import { ResponseTimeChart } from '@/components/response-time-chart'
import { getPageSpeedHistory, getResponseTimes, getSiteHeader } from '@/lib/queries'
import { assertMembership, requireUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function DesempenhoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const header = await getSiteHeader(id)
  if (!header) notFound()
  assertMembership(user, header.site.organizationId)

  // Duas coisas diferentes com o mesmo nome no dia a dia: a velocidade é o
  // tempo que a página leva a ficar utilizável para quem a abre; o tempo de
  // resposta é o que o servidor demora a dizer a primeira palavra. Um site
  // pode ter o segundo excelente e o primeiro péssimo.
  const [velocidade, dias] = await Promise.all([getPageSpeedHistory(id), getResponseTimes(id)])

  return (
    <>
      <Card>
        <CardHeader
          title="Velocidade das páginas"
          action={<span className="text-xs text-ink-400">PageSpeed Insights</span>}
        />
        <PageSpeedPanel history={velocidade} />
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
