import { notFound } from 'next/navigation'
import {
  listMembers,
  organizationObjections,
  pruneEndedWindows,
  windowState,
} from '@jellycare/db'
import { Card, CardHeader } from '@/components/ui'
import { getDb } from '@/lib/db'
import { getLegalState } from '@/lib/legal'
import { getSiteDetail } from '@/lib/queries'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import { AccessPanel } from '../access-panel'
import { LegalPanel } from '../legal-panel'
import { MaintenancePanel } from '../maintenance-panel'
import { SettingsPanel } from '../settings-panel'

export const dynamic = 'force-dynamic'

export default async function DefinicoesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()
  assertMembership(user, detail.site.organizationId)
  const manageable = canManage(user, detail.site.organizationId)

  const members = await listMembers(getDb(), detail.site.organizationId)
  const legal = await getLegalState(detail.site.organizationId)
  const objecoes = await organizationObjections(getDb(), detail.site.organizationId)

  return (
    <>
      <Card>
        <CardHeader title="Janelas de manutenção" />
        <MaintenancePanel
          siteId={detail.site.id}
          windows={pruneEndedWindows(detail.site.maintenanceWindows).map((janela) => ({
            start: janela.start,
            end: janela.end,
            estado: windowState(janela),
          }))}
          schedule={detail.site.maintenanceSchedule}
          canManage={manageable}
        />
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
    </>
  )
}
