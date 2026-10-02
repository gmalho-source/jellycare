import { notFound } from 'next/navigation'
import {
  listMembers,
  listarOrganizacoes,
  organizationObjections,
  pruneEndedWindows,
  windowState,
} from '@jellycare/db'
import { Card, CardHeader } from '@/components/ui'
import { getDb } from '@/lib/db'
import { getLegalState } from '@/lib/legal'
import { getSiteDetail } from '@/lib/queries'
import { listUmbrellaProjects } from '@/lib/umbrella'
import { assertMembership, canManage, requireUser } from '@/lib/session'
import Link from 'next/link'
import { MoverSite } from '../../../organizacoes/formularios'
import { AccessPanel } from '../access-panel'
import { DangerPanel } from '../danger-panel'
import { LegalPanel } from '../legal-panel'
import { MaintenancePanel } from '../maintenance-panel'
import { SettingsPanel } from '../settings-panel'
import { UmbrellaLink } from '../umbrella-link'

export const dynamic = 'force-dynamic'

export default async function DefinicoesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

  const detail = await getSiteDetail(id)
  if (!detail) notFound()
  assertMembership(user, detail.site.organizationId)
  const manageable = canManage(user, detail.site.organizationId)

  // A lista de projetos é da conta da Jelly e só interessa a quem pode
  // ligar — não se vai pedi-la à WP Umbrella para a deitar fora a seguir.
  const umbrella = manageable
    ? await listUmbrellaProjects()
    : { projects: [], unavailable: undefined }

  const members = await listMembers(getDb(), detail.site.organizationId)
  const legal = await getLegalState(detail.site.organizationId)
  const objecoes = await organizationObjections(getDb(), detail.site.organizationId)
  const organizacoes = await listarOrganizacoes(getDb(), user.memberships.map((m) => m.organizationId))
  const daOrganizacao = organizacoes.find((organizacao) => organizacao.id === detail.site.organizationId)

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
            expectedContent={detail.site.expectedContent}
            recipients={detail.site.reportRecipients}
            slaTarget={detail.site.slaTarget}
          />
        </Card>
      ) : null}

      {manageable ? (
        <Card>
          <CardHeader title="WordPress" />
          <UmbrellaLink
            siteId={detail.site.id}
            linkedId={detail.connector?.externalId ?? null}
            options={umbrella.projects.map((project) => ({
              id: project.id,
              name: project.name,
              baseUrl: project.baseUrl,
              connectivity: project.connectivity,
            }))}
            {...(umbrella.unavailable ? { unavailable: umbrella.unavailable } : {})}
            canManage={manageable}
          />
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Cliente"
          action={
            <Link
              href={`/organizacoes/${detail.site.organizationId}`}
              className="text-xs font-semibold text-ink-600 hover:text-ink-900"
            >
              Contactos e acessos de {daOrganizacao?.name ?? 'a organização'} →
            </Link>
          }
        />
        {user.isStaff ? (
          <MoverSite
            siteId={detail.site.id}
            atual={detail.site.organizationId}
            organizacoes={organizacoes.map((organizacao) => ({ id: organizacao.id, name: organizacao.name }))}
          />
        ) : (
          <p className="px-5 py-4 text-sm text-ink-600">{daOrganizacao?.name}</p>
        )}
      </Card>

      {manageable ? (
        <Card>
          <CardHeader title="Arquivar ou apagar" />
          <DangerPanel
            siteId={detail.site.id}
            label={detail.site.label}
            state={detail.site.state}
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
    </>
  )
}
