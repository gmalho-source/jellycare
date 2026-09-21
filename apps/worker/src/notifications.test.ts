import type { FindingNotification, Severity } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import {
  deliverableTargets,
  groupForDigest,
  renderNotification,
  routeNotification,
  type NotificationTarget,
  type RoutingContext,
} from './notifications.js'

const NOW = new Date('2026-09-17T10:00:00Z')

function context(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    organizationId: 'org-1',
    siteId: 'site-1',
    siteLabel: 'Cliente',
    maintenanceWindows: [],
    now: NOW,
    ...overrides,
  }
}

function target(overrides: Partial<NotificationTarget> = {}): NotificationTarget {
  return {
    id: 'target-1',
    organizationId: 'org-1',
    siteId: null,
    channel: 'email',
    destination: 'alertas@cliente.pt',
    minSeverity: 'high',
    enabled: true,
    ...overrides,
  }
}

function notification(overrides: Partial<FindingNotification> = {}): FindingNotification {
  return {
    kind: 'opened',
    fingerprint: 'fp1',
    siteId: 'site-1',
    checkType: 'uptime',
    code: 'site_down',
    severity: 'critical' as Severity,
    title: 'Site inacessível',
    detail: 'Não foi possível obter https://cliente.pt.',
    ...overrides,
  }
}

function reasons(decisions: ReturnType<typeof routeNotification>): string[] {
  return decisions.filter((d) => !d.deliver).map((d) => (d as { reason: string }).reason)
}

describe('routeNotification', () => {
  it('entrega um crítico ao canal configurado', () => {
    expect(deliverableTargets(notification(), [target()], context())).toHaveLength(1)
  })

  it('não entrega a canais desativados', () => {
    const decisions = routeNotification(notification(), [target({ enabled: false })], context())
    expect(reasons(decisions)).toEqual(['canal desativado'])
  })

  it('isola organizações', () => {
    const decisions = routeNotification(
      notification(),
      [target({ organizationId: 'org-2' })],
      context(),
    )
    expect(reasons(decisions)).toEqual(['outra organização'])
  })

  it('respeita canais dedicados a um site', () => {
    const outro = target({ siteId: 'site-2' })
    const proprio = target({ id: 'target-2', siteId: 'site-1' })

    const delivered = deliverableTargets(notification(), [outro, proprio], context())
    expect(delivered.map((t) => t.id)).toEqual(['target-2'])
  })

  it('respeita a severidade mínima do canal', () => {
    const decisions = routeNotification(
      notification({ severity: 'high' }),
      [target({ minSeverity: 'critical' })],
      context(),
    )
    expect(reasons(decisions)[0]).toContain('abaixo do mínimo')
  })

  it('não gera alerta imediato para severidades de resumo', () => {
    // Um link quebrado é médio: entra no resumo diário, não interrompe ninguém.
    const decisions = routeNotification(
      notification({ severity: 'medium', code: 'link_broken' }),
      [target({ minSeverity: 'low' })],
      context(),
    )
    expect(reasons(decisions)[0]).toContain('resumo')
  })

  it('suprime alertas durante uma janela de manutenção', () => {
    const decisions = routeNotification(
      notification(),
      [target()],
      context({
        maintenanceWindows: [{ start: '2026-09-17T09:00:00Z', end: '2026-09-17T11:00:00Z' }],
      }),
    )
    expect(reasons(decisions)).toEqual(['janela de manutenção'])
  })

  it('deixa passar a recuperação mesmo em manutenção', () => {
    // Saber que o site voltou é útil mesmo durante um deploy planeado.
    const delivered = deliverableTargets(
      notification({ kind: 'resolved' }),
      [target()],
      context({
        maintenanceWindows: [{ start: '2026-09-17T09:00:00Z', end: '2026-09-17T11:00:00Z' }],
      }),
    )
    expect(delivered).toHaveLength(1)
  })
})

describe('renderNotification', () => {
  it('escreve em linguagem de negócio, não de sysadmin', () => {
    const rendered = renderNotification(notification(), { siteLabel: 'Cliente' }, 'https://cliente.pt')

    expect(rendered.subject).toBe('[Jellycare] Cliente: Site inacessível')
    expect(rendered.text).toContain('Novo problema — Crítico')
    expect(rendered.text).toContain('Site: Cliente (https://cliente.pt)')
  })

  it('explica o agravamento', () => {
    const rendered = renderNotification(
      notification({ kind: 'escalated', severity: 'critical', previousSeverity: 'medium' }),
      { siteLabel: 'Cliente' },
      'https://cliente.pt',
    )

    expect(rendered.text).toContain('subiu de Médio para Crítico')
  })

  it('diz explicitamente que uma recuperação não exige ação', () => {
    const rendered = renderNotification(
      notification({ kind: 'resolved' }),
      { siteLabel: 'Cliente' },
      'https://cliente.pt',
    )

    expect(rendered.text).toContain('Nenhuma ação é necessária')
  })

  it('inclui o local do problema quando existe', () => {
    const rendered = renderNotification(
      notification({ discriminator: 'https://cliente.pt/sobre' }),
      { siteLabel: 'Cliente' },
      'https://cliente.pt',
    )

    expect(rendered.text).toContain('Onde: https://cliente.pt/sobre')
    expect(JSON.stringify(rendered.slackBlocks)).toContain('https://cliente.pt/sobre')
  })
})

describe('groupForDigest', () => {
  it('junta ocorrências do mesmo problema numa entrada', () => {
    const notifications = [
      notification({ severity: 'medium', code: 'link_broken', discriminator: '/a', checkType: 'broken_links' }),
      notification({ severity: 'medium', code: 'link_broken', discriminator: '/b', checkType: 'broken_links' }),
      notification({ severity: 'medium', code: 'link_broken', discriminator: '/c', checkType: 'broken_links' }),
    ]

    const groups = groupForDigest(notifications)
    // Quinze links quebrados são uma entrada no resumo, não quinze emails.
    expect(groups.size).toBe(1)
    expect([...groups.values()][0]).toHaveLength(3)
  })

  it('deixa de fora o que já foi entregue como alerta imediato', () => {
    const groups = groupForDigest([notification({ severity: 'critical' })])
    expect(groups.size).toBe(0)
  })

  it('deixa de fora o que só aparece no relatório mensal', () => {
    const groups = groupForDigest([notification({ severity: 'low' })])
    expect(groups.size).toBe(0)
  })

  it('separa sites diferentes', () => {
    const groups = groupForDigest([
      notification({ severity: 'medium', siteId: 'site-1' }),
      notification({ severity: 'medium', siteId: 'site-2' }),
    ])
    expect(groups.size).toBe(2)
  })
})
