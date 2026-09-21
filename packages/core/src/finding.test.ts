import { describe, expect, it } from 'vitest'
import {
  fingerprintOf,
  reconcileFindings,
  type ObservedFinding,
  type StoredFinding,
} from './finding.js'
import type { Severity } from './severity.js'

const SITE = 'site-1'
const CHECK = 'broken_links'
const NOW = new Date('2026-09-17T10:00:00Z')

function observed(overrides: Partial<ObservedFinding> = {}): ObservedFinding {
  return {
    code: 'link_broken',
    discriminator: 'https://cliente.pt/sobre',
    severity: 'medium',
    title: 'Link quebrado',
    ...overrides,
  }
}

function stored(overrides: Partial<StoredFinding> = {}): StoredFinding {
  const code = overrides.code ?? 'link_broken'
  const discriminator =
    'discriminator' in overrides ? overrides.discriminator : 'https://cliente.pt/sobre'
  return {
    id: 'finding-1',
    siteId: SITE,
    checkType: CHECK,
    fingerprint: fingerprintOf(SITE, CHECK, code, discriminator),
    code,
    discriminator,
    severity: 'medium' as Severity,
    state: 'open',
    title: 'Link quebrado',
    firstSeenAt: new Date('2026-09-10T10:00:00Z'),
    lastSeenAt: new Date('2026-09-16T10:00:00Z'),
    occurrences: 5,
    ...overrides,
  }
}

describe('fingerprintOf', () => {
  it('é estável para a mesma ocorrência', () => {
    expect(fingerprintOf(SITE, CHECK, 'link_broken', '/a')).toBe(
      fingerprintOf(SITE, CHECK, 'link_broken', '/a'),
    )
  })

  it('separa ocorrências diferentes do mesmo código', () => {
    expect(fingerprintOf(SITE, CHECK, 'link_broken', '/a')).not.toBe(
      fingerprintOf(SITE, CHECK, 'link_broken', '/b'),
    )
  })

  it('não confunde campos concatenados', () => {
    // Sem separador, ('ab', 'c') e ('a', 'bc') colidiriam.
    expect(fingerprintOf(SITE, CHECK, 'ab', 'c')).not.toBe(fingerprintOf(SITE, CHECK, 'a', 'bc'))
  })

  it('isola sites diferentes', () => {
    expect(fingerprintOf('site-1', CHECK, 'link_broken', '/a')).not.toBe(
      fingerprintOf('site-2', CHECK, 'link_broken', '/a'),
    )
  })
})

describe('reconcileFindings — problema novo', () => {
  it('abre e notifica à primeira quando não exige confirmação', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed()],
      existing: [],
      now: NOW,
    })

    expect(result.creates).toHaveLength(1)
    expect(result.creates[0]?.state).toBe('open')
    expect(result.creates[0]?.occurrences).toBe(1)
    expect(result.notifications).toHaveLength(1)
    expect(result.notifications[0]?.kind).toBe('opened')
  })

  it('fica pendente e silencioso enquanto não confirma', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed()],
      existing: [],
      confirmationsRequired: 2,
      now: NOW,
    })

    expect(result.creates[0]?.state).toBe('pending')
    expect(result.notifications).toHaveLength(0)
  })

  it('notifica assim que a segunda observação confirma', () => {
    const pending = stored({ state: 'pending', occurrences: 1 })
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed()],
      existing: [pending],
      confirmationsRequired: 2,
      now: NOW,
    })

    expect(result.updates[0]?.changes.state).toBe('open')
    expect(result.updates[0]?.changes.occurrences).toBe(2)
    expect(result.notifications).toHaveLength(1)
    expect(result.notifications[0]?.kind).toBe('opened')
  })

  it('não duplica quando o mesmo problema aparece duas vezes no mesmo run', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed(), observed()],
      existing: [],
      now: NOW,
    })

    expect(result.creates).toHaveLength(1)
    expect(result.notifications).toHaveLength(1)
  })
})

describe('reconcileFindings — problema que persiste', () => {
  it('não volta a notificar com a mesma severidade', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed()],
      existing: [stored()],
      now: NOW,
    })

    expect(result.notifications).toHaveLength(0)
    expect(result.updates[0]?.changes.lastSeenAt).toEqual(NOW)
    expect(result.updates[0]?.changes.occurrences).toBe(6)
  })

  it('notifica quando a severidade agrava', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed({ severity: 'critical' })],
      existing: [stored({ severity: 'medium' })],
      now: NOW,
    })

    expect(result.notifications).toHaveLength(1)
    expect(result.notifications[0]?.kind).toBe('escalated')
    expect(result.notifications[0]?.previousSeverity).toBe('medium')
    expect(result.notifications[0]?.severity).toBe('critical')
  })

  it('não notifica quando a severidade alivia', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed({ severity: 'low' })],
      existing: [stored({ severity: 'high' })],
      now: NOW,
    })

    expect(result.notifications).toHaveLength(0)
    expect(result.updates[0]?.changes.severity).toBe('low')
  })

  it('reabre um finding reconhecido quando agrava', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed({ severity: 'critical' })],
      existing: [stored({ state: 'acknowledged', severity: 'low' })],
      now: NOW,
    })

    expect(result.updates[0]?.changes.state).toBe('open')
    expect(result.notifications[0]?.kind).toBe('escalated')
  })

  it('mantém silêncio num finding reconhecido que não agrava', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed()],
      existing: [stored({ state: 'acknowledged' })],
      now: NOW,
    })

    expect(result.notifications).toHaveLength(0)
    expect(result.updates[0]?.changes.state).toBeUndefined()
  })
})

describe('reconcileFindings — silenciados', () => {
  it('nunca notifica um finding ignorado, mesmo que agrave', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed({ severity: 'critical' })],
      existing: [stored({ state: 'ignored', severity: 'low' })],
      now: NOW,
    })

    expect(result.notifications).toHaveLength(0)
    expect(result.updates[0]?.changes.state).toBeUndefined()
  })

  it('não resolve um finding ignorado que deixou de ser observado', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [],
      existing: [stored({ state: 'ignored' })],
      now: NOW,
    })

    expect(result.updates).toHaveLength(0)
    expect(result.notifications).toHaveLength(0)
  })
})

describe('reconcileFindings — resolução', () => {
  it('resolve o que deixou de ser observado', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [],
      existing: [stored()],
      now: NOW,
    })

    expect(result.updates[0]?.changes.state).toBe('resolved')
    expect(result.updates[0]?.changes.resolvedAt).toEqual(NOW)
  })

  it('avisa da recuperação só quando o problema era grave', () => {
    const critical = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [],
      existing: [stored({ severity: 'critical' })],
      now: NOW,
    })
    expect(critical.notifications[0]?.kind).toBe('resolved')

    const low = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [],
      existing: [stored({ severity: 'low' })],
      now: NOW,
    })
    expect(low.notifications).toHaveLength(0)
  })

  it('não avisa da recuperação de algo que nunca chegou a abrir', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [],
      existing: [stored({ state: 'pending', severity: 'critical', occurrences: 1 })],
      now: NOW,
    })

    expect(result.updates[0]?.changes.state).toBe('resolved')
    expect(result.notifications).toHaveLength(0)
  })

  it('um run falhado não resolve nada', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [],
      existing: [stored(), stored({ id: 'finding-2', discriminator: '/outra' })],
      runSucceeded: false,
      now: NOW,
    })

    expect(result.updates).toHaveLength(0)
    expect(result.notifications).toHaveLength(0)
  })
})

describe('reconcileFindings — reabertura', () => {
  it('reabre e notifica um problema que volta', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed()],
      existing: [
        stored({ state: 'resolved', resolvedAt: new Date('2026-09-15T10:00:00Z'), occurrences: 0 }),
      ],
      now: NOW,
    })

    expect(result.updates[0]?.changes.state).toBe('open')
    expect(result.updates[0]?.changes.occurrences).toBe(1)
    expect(result.updates[0]?.changes.resolvedAt).toBeUndefined()
    expect(result.notifications[0]?.kind).toBe('reopened')
  })

  it('exige nova confirmação ao reabrir, para não gerar alertas em ciclo', () => {
    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed()],
      existing: [stored({ state: 'resolved', occurrences: 0 })],
      confirmationsRequired: 2,
      now: NOW,
    })

    expect(result.updates[0]?.changes.state).toBe('pending')
    expect(result.notifications).toHaveLength(0)
  })
})

describe('reconcileFindings — vários findings no mesmo run', () => {
  it('trata cada ocorrência de forma independente', () => {
    const existingBroken = stored({ id: 'a', discriminator: '/a' })
    const existingResolvable = stored({ id: 'b', discriminator: '/b', severity: 'critical' })

    const result = reconcileFindings({
      siteId: SITE,
      checkType: CHECK,
      observed: [observed({ discriminator: '/a' }), observed({ discriminator: '/c' })],
      existing: [existingBroken, existingResolvable],
      now: NOW,
    })

    expect(result.creates).toHaveLength(1)
    expect(result.creates[0]?.discriminator).toBe('/c')

    const resolved = result.updates.find((u) => u.id === 'b')
    expect(resolved?.changes.state).toBe('resolved')

    const persisted = result.updates.find((u) => u.id === 'a')
    expect(persisted?.changes.state).toBeUndefined()

    expect(result.notifications.map((n) => n.kind).sort()).toEqual(['opened', 'resolved'])
  })
})
