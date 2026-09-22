import { buildChallenge } from '@jellycare/checks'
import { notFound } from 'next/navigation'
import { Card, EmptyState } from '@/components/ui'
import { DashboardOverview } from '@/components/site-dashboard'
import { getSiteDashboard } from '@/lib/dashboard'
import { getPendingVerification, getSiteHeader } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { VerificationPanel } from './verification-panel'

export const dynamic = 'force-dynamic'

/**
 * A visão geral de um site.
 *
 * Só o que responde a «como está isto agora»: os números do período, a faixa
 * de disponibilidade, as interrupções e o que foi feito. O resto vive nas
 * secções, e é isso que faz esta página carregar o que mostra em vez de
 * carregar tudo o que o site tem.
 */
export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const header = await getSiteHeader(id)
  if (!header) notFound()
  assertMembership(user, header.site.organizationId)
  const manageable = canManage(user, header.site.organizationId)

  // Só depois de verificado. Antes disso só há disponibilidade, e um painel
  // de métricas com tudo a zero diz menos do que o aviso que está no lugar.
  const dashboard = header.verified ? await getSiteDashboard(id) : null
  const verification = header.verified ? null : await getPendingVerification(id)

  // As duas vias, com o mesmo token. A que foi escolhida na criação aparece
  // primeiro; a outra fica disponível sem ninguém ter de trocar nada.
  const challenge = verification
    ? buildChallenge(verification.method, header.site.hostname, verification.token)
    : null
  const alternative = verification
    ? buildChallenge(
        verification.method === 'dns_txt' ? 'http_file' : 'dns_txt',
        header.site.hostname,
        verification.token,
      )
    : null

  return (
    <>
      {challenge && alternative && (
        <VerificationPanel
          siteId={header.site.id}
          challenge={challenge}
          alternative={alternative}
          canManage={manageable}
        />
      )}

      {dashboard ? (
        <DashboardOverview data={dashboard} />
      ) : (
        <Card>
          <EmptyState>
            As métricas aparecem aqui assim que a propriedade do domínio estiver provada.
          </EmptyState>
        </Card>
      )}
    </>
  )
}
