import { runCheck, type CheckContext } from '@jellycare/core'
import { describe, expect, it } from 'vitest'
import { testSite } from './test-utils.js'
import {
  certificateCoversHostname,
  certificateNameMatches,
  expirySeverity,
  tlsCheck,
  type CertificateInfo,
} from './tls.js'

const NOW = new Date('2026-09-17T10:00:00Z')

function certificate(overrides: Partial<CertificateInfo> = {}): CertificateInfo {
  return {
    subject: 'cliente.pt',
    issuer: "Let's Encrypt",
    validFrom: new Date('2026-08-01T00:00:00Z'),
    validTo: new Date('2026-11-01T00:00:00Z'),
    subjectAltNames: ['cliente.pt', 'www.cliente.pt'],
    keyBits: 2048,
    authorized: true,
    ...overrides,
  }
}

async function run(cert: CertificateInfo) {
  const context: CheckContext = { site: testSite, now: NOW, fetch: globalThis.fetch }
  return runCheck(tlsCheck, context, { fetcher: async () => cert })
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code).sort()
}

describe('certificateNameMatches', () => {
  it('aceita correspondência exata', () => {
    expect(certificateNameMatches('cliente.pt', 'cliente.pt')).toBe(true)
  })

  it('é indiferente a maiúsculas', () => {
    expect(certificateNameMatches('Cliente.PT', 'cliente.pt')).toBe(true)
  })

  it('aceita um wildcard no nível imediato', () => {
    expect(certificateNameMatches('*.cliente.pt', 'www.cliente.pt')).toBe(true)
  })

  it('rejeita o domínio base num wildcard', () => {
    // *.cliente.pt não cobre cliente.pt — o browser rejeita, e nós também.
    expect(certificateNameMatches('*.cliente.pt', 'cliente.pt')).toBe(false)
  })

  it('rejeita mais do que um nível num wildcard', () => {
    expect(certificateNameMatches('*.cliente.pt', 'a.b.cliente.pt')).toBe(false)
  })

  it('rejeita um sufixo que não é fronteira de label', () => {
    // Um endsWith ingénuo daria isto por válido.
    expect(certificateNameMatches('*.cliente.pt', 'atacante-cliente.pt')).toBe(false)
    expect(certificateNameMatches('cliente.pt', 'naocliente.pt')).toBe(false)
  })

  it('rejeita um label vazio', () => {
    expect(certificateNameMatches('*.cliente.pt', '.cliente.pt')).toBe(false)
  })
})

describe('certificateCoversHostname', () => {
  it('usa os SAN quando existem', () => {
    const cert = certificate({ subject: 'outro.pt', subjectAltNames: ['cliente.pt'] })
    expect(certificateCoversHostname(cert, 'cliente.pt')).toBe(true)
  })

  it('cai para o subject quando não há SAN', () => {
    const cert = certificate({ subject: 'cliente.pt', subjectAltNames: [] })
    expect(certificateCoversHostname(cert, 'cliente.pt')).toBe(true)
  })
})

describe('expirySeverity', () => {
  it('escala com a proximidade da expiração', () => {
    expect(expirySeverity(-1)).toBe('critical')
    expect(expirySeverity(3)).toBe('high')
    expect(expirySeverity(10)).toBe('medium')
    expect(expirySeverity(25)).toBe('low')
    expect(expirySeverity(60)).toBeNull()
  })
})

describe('tlsCheck', () => {
  it('não reporta nada com um certificado saudável', async () => {
    const outcome = await run(certificate())
    expect(outcome.findings).toEqual([])
    expect(outcome.metrics.certDaysRemaining).toBe(44)
  })

  it('avisa da expiração próxima', async () => {
    const outcome = await run(certificate({ validTo: new Date('2026-09-22T10:00:00Z') }))
    expect(outcome.findings[0]?.code).toBe('cert_expiring')
    expect(outcome.findings[0]?.severity).toBe('high')
  })

  it('reporta certificado expirado como crítico', async () => {
    const outcome = await run(
      certificate({ validTo: new Date('2026-09-10T10:00:00Z'), authorized: false }),
    )

    // Um certificado expirado também falha a validação da cadeia. Reportar as
    // duas coisas seria dois alertas para a mesma causa.
    expect(codes(outcome.findings)).toEqual(['cert_expired'])
    expect(outcome.findings[0]?.severity).toBe('critical')
  })

  it('deteta certificado que não cobre o domínio', async () => {
    const outcome = await run(
      certificate({ subject: 'outro.pt', subjectAltNames: ['outro.pt', '*.outro.pt'] }),
    )

    expect(codes(outcome.findings)).toEqual(['cert_hostname_mismatch'])
    expect(outcome.findings[0]?.severity).toBe('critical')
  })

  it('reporta cadeia não confiável quando a data está boa', async () => {
    const outcome = await run(
      certificate({ authorized: false, authorizationError: 'SELF_SIGNED_CERT_IN_CHAIN' }),
    )

    expect(codes(outcome.findings)).toEqual(['cert_untrusted'])
    expect(outcome.findings[0]?.detail).toContain('SELF_SIGNED')
  })

  it('reporta chave fraca', async () => {
    const outcome = await run(certificate({ keyBits: 1024 }))
    expect(codes(outcome.findings)).toEqual(['cert_weak_key'])
  })

  it('marca o run como falhado quando não consegue ligar', async () => {
    const context: CheckContext = { site: testSite, now: NOW, fetch: globalThis.fetch }
    const outcome = await runCheck(tlsCheck, context, {
      fetcher: async () => {
        throw new Error('ECONNREFUSED')
      },
    })

    // Aqui é correto falhar: não observámos o certificado, por isso não podemos
    // concluir que os problemas anteriores desapareceram.
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('ECONNREFUSED')
  })
})
