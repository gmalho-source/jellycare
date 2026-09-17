import { describe, expect, it } from 'vitest'
import {
  assessDelivery,
  extractCanaryReference,
  parseAuthenticationResults,
  type InboundEmail,
} from './mailbox.js'

const SUBMITTED_AT = new Date('2026-09-17T10:00:00Z')

function email(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    to: 'check+site1-abc12345@check.jellycare.pt',
    from: 'wordpress@cliente.pt',
    subject: 'Novo contacto do site',
    text: 'Referência do teste: abc12345',
    headers: {},
    receivedAt: new Date('2026-09-17T10:00:12Z'),
    ...overrides,
  }
}

describe('extractCanaryReference', () => {
  it('lê o site e o token do endereço', () => {
    expect(extractCanaryReference(email())).toEqual({ siteId: 'site1', token: 'abc12345' })
  })

  it('cai para o corpo quando o formulário não preserva o destinatário', () => {
    // Muitos formulários enviam a notificação a partir de um endereço próprio
    // e perdem o subendereçamento pelo caminho.
    const reference = extractCanaryReference(
      email({ to: 'geral@cliente.pt', text: 'Mensagem:\nReferência do teste: abc12345\n' }),
    )

    expect(reference?.token).toBe('abc12345')
  })

  it('encontra o endereço canário citado no corpo', () => {
    const reference = extractCanaryReference(
      email({
        to: 'geral@cliente.pt',
        text: 'De: check+site1-abc12345@check.jellycare.pt',
      }),
    )

    expect(reference).toEqual({ siteId: 'site1', token: 'abc12345' })
  })

  it('procura também no HTML', () => {
    const reference = extractCanaryReference(
      email({
        to: 'geral@cliente.pt',
        text: undefined,
        html: '<p>Referência do teste: abc12345</p>',
      }),
    )

    expect(reference?.token).toBe('abc12345')
  })

  it('devolve nulo quando o email não tem nada nosso', () => {
    expect(
      extractCanaryReference(email({ to: 'geral@cliente.pt', text: 'Olá, queria um orçamento.' })),
    ).toBeNull()
  })
})

describe('parseAuthenticationResults', () => {
  it('lê os três métodos de um cabeçalho típico do Google', () => {
    const results = parseAuthenticationResults(
      'mx.google.com; spf=pass (google.com: domain of wordpress@cliente.pt designates 1.2.3.4) smtp.mailfrom=wordpress@cliente.pt; dkim=pass header.i=@cliente.pt; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=cliente.pt',
    )

    expect(results).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'pass' })
  })

  it('não se deixa enganar por palavras dentro dos comentários', () => {
    // O comentário do DMARC contém "dis=NONE" e outras palavras que um parser
    // ingénuo confundiria com o resultado.
    const results = parseAuthenticationResults(
      'mx.google.com; spf=fail (google.com: best guess record for domain does not designate permitted sender) smtp.mailfrom=x@cliente.pt; dkim=none',
    )

    expect(results.spf).toBe('fail')
    expect(results.dkim).toBe('none')
  })

  it('usa o primeiro resultado conclusivo quando há vários cabeçalhos', () => {
    const results = parseAuthenticationResults([
      'inbox.jellycare.pt; spf=pass; dkim=pass',
      'relay.intermedio.pt; spf=fail; dkim=fail; dmarc=fail',
    ])

    expect(results).toMatchObject({ spf: 'pass', dkim: 'pass', dmarc: 'fail' })
  })

  it('devolve nulos quando o cabeçalho não existe', () => {
    expect(parseAuthenticationResults(undefined)).toEqual({ spf: null, dkim: null, dmarc: null })
  })
})

describe('assessDelivery', () => {
  it('mede a latência da notificação', () => {
    const assessment = assessDelivery(email(), SUBMITTED_AT)
    expect(assessment.received).toBe(true)
    expect(assessment.latencyMs).toBe(12_000)
  })

  it('não reporta riscos quando a autenticação passa', () => {
    const assessment = assessDelivery(
      email({ headers: { 'authentication-results': 'mx; spf=pass; dkim=pass; dmarc=pass' } }),
      SUBMITTED_AT,
    )

    expect(assessment.deliverabilityRisks).toEqual([])
  })

  it('assinala falha de SPF e DKIM como risco de entrega no spam', () => {
    const assessment = assessDelivery(
      email({ headers: { 'authentication-results': 'mx; spf=fail; dkim=none; dmarc=fail' } }),
      SUBMITTED_AT,
    )

    expect(assessment.deliverabilityRisks).toHaveLength(3)
    expect(assessment.auth).toMatchObject({ spf: 'fail', dkim: 'none', dmarc: 'fail' })
  })

  it('só afirma que caiu no spam quando o fornecedor o diz', () => {
    // Inferir o spam a partir da autenticação seria dizer ao cliente algo que
    // não observámos.
    const semVeredito = assessDelivery(
      email({ headers: { 'authentication-results': 'mx; spf=fail' } }),
      SUBMITTED_AT,
    )
    expect(semVeredito.landedInSpam).toBeNull()

    const comVeredito = assessDelivery(email({ spamVerdict: 'fail' }), SUBMITTED_AT)
    expect(comVeredito.landedInSpam).toBe(true)

    const limpo = assessDelivery(email({ spamVerdict: 'pass' }), SUBMITTED_AT)
    expect(limpo.landedInSpam).toBe(false)
  })

  it('nunca devolve latência negativa', () => {
    const assessment = assessDelivery(
      email({ receivedAt: new Date('2026-09-17T09:59:58Z') }),
      SUBMITTED_AT,
    )
    expect(assessment.latencyMs).toBe(0)
  })
})
