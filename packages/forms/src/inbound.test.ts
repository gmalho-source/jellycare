import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  normaliseHeaders,
  parseInboundPayload,
  verifyInboundSignature,
} from './inbound.js'

const SECRET = 'segredo-da-inbox'
const NOW = new Date('2026-09-17T10:00:00Z')
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000))

function sign(payload: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

describe('verifyInboundSignature — esquema próprio', () => {
  const rawBody = '{"to":"check+site1-abc12345@check.jellycare.pt"}'

  function verify(overrides: Partial<Parameters<typeof verifyInboundSignature>[0]> = {}) {
    return verifyInboundSignature({
      scheme: 'jellycare',
      secret: SECRET,
      rawBody,
      timestamp: TIMESTAMP,
      signature: sign(`${TIMESTAMP}.${rawBody}`),
      now: NOW,
      ...overrides,
    })
  }

  it('aceita uma assinatura válida', () => {
    expect(verify()).toEqual({ valid: true })
  })

  it('aceita o prefixo sha256=', () => {
    expect(verify({ signature: `sha256=${sign(`${TIMESTAMP}.${rawBody}`)}` })).toEqual({
      valid: true,
    })
  })

  it('rejeita uma assinatura de outro segredo', () => {
    expect(verify({ signature: sign(`${TIMESTAMP}.${rawBody}`, 'outro') })).toEqual({
      valid: false,
      reason: 'mismatch',
    })
  })

  it('rejeita quando o corpo foi alterado depois de assinado', () => {
    expect(verify({ rawBody: '{"to":"outro@check.jellycare.pt"}' })).toEqual({
      valid: false,
      reason: 'mismatch',
    })
  })

  it('rejeita uma entrega antiga, para não permitir reenvio', () => {
    const antiga = String(Math.floor(NOW.getTime() / 1000) - 3600)
    expect(
      verify({ timestamp: antiga, signature: sign(`${antiga}.${rawBody}`) }),
    ).toEqual({ valid: false, reason: 'stale' })
  })

  it('rejeita um carimbo no futuro', () => {
    const futuro = String(Math.floor(NOW.getTime() / 1000) + 3600)
    expect(verify({ timestamp: futuro, signature: sign(`${futuro}.${rawBody}`) })).toEqual({
      valid: false,
      reason: 'stale',
    })
  })

  it('tolera um desvio pequeno de relógio', () => {
    const ligeiro = String(Math.floor(NOW.getTime() / 1000) - 60)
    expect(verify({ timestamp: ligeiro, signature: sign(`${ligeiro}.${rawBody}`) })).toEqual({
      valid: true,
    })
  })

  it('rejeita quando falta assinatura ou carimbo', () => {
    expect(verify({ signature: '' })).toEqual({ valid: false, reason: 'missing' })
    expect(verify({ timestamp: '' })).toEqual({ valid: false, reason: 'missing' })
    expect(verify({ timestamp: 'ontem' })).toEqual({ valid: false, reason: 'missing' })
  })
})

describe('verifyInboundSignature — Mailgun', () => {
  it('valida a assinatura sobre carimbo e token', () => {
    const token = 'token-da-mensagem'
    const verdict = verifyInboundSignature({
      scheme: 'mailgun',
      secret: SECRET,
      rawBody: 'ignorado',
      timestamp: TIMESTAMP,
      token,
      signature: sign(`${TIMESTAMP}${token}`),
      now: NOW,
    })

    expect(verdict).toEqual({ valid: true })
  })

  it('exige o token', () => {
    expect(
      verifyInboundSignature({
        scheme: 'mailgun',
        secret: SECRET,
        rawBody: '',
        timestamp: TIMESTAMP,
        signature: sign(`${TIMESTAMP}x`),
        now: NOW,
      }),
    ).toEqual({ valid: false, reason: 'missing' })
  })
})

describe('normaliseHeaders', () => {
  it('aceita a lista de pares do Mailgun', () => {
    const headers = normaliseHeaders([
      ['Authentication-Results', 'mx; spf=pass'],
      ['X-Spam-Flag', 'NO'],
    ])

    expect(headers['authentication-results']).toBe('mx; spf=pass')
    expect(headers['x-spam-flag']).toBe('NO')
  })

  it('aceita a lista em JSON', () => {
    const headers = normaliseHeaders('[["Subject","Olá"]]')
    expect(headers['subject']).toBe('Olá')
  })

  it('aceita um objeto', () => {
    expect(normaliseHeaders({ Subject: 'Olá' })['subject']).toBe('Olá')
  })

  it('junta cabeçalhos repetidos numa lista', () => {
    const headers = normaliseHeaders([
      ['Authentication-Results', 'inbox; spf=pass'],
      ['Authentication-Results', 'relay; spf=fail'],
    ])

    expect(headers['authentication-results']).toEqual(['inbox; spf=pass', 'relay; spf=fail'])
  })

  it('não rebenta com entradas inesperadas', () => {
    expect(normaliseHeaders('isto não é JSON')).toEqual({})
    expect(normaliseHeaders(null)).toEqual({})
    expect(normaliseHeaders([1, 2, 3])).toEqual({})
  })
})

describe('parseInboundPayload', () => {
  it('lê uma entrega do Mailgun', () => {
    const email = parseInboundPayload({
      recipient: 'check+site1-abc12345@check.jellycare.pt',
      sender: 'wordpress@cliente.pt',
      subject: 'Novo contacto',
      'body-plain': 'Referência do teste: abc12345',
      'message-headers': [['Authentication-Results', 'mx; spf=pass; dkim=pass; dmarc=pass']],
      timestamp: String(Math.floor(NOW.getTime() / 1000)),
    })

    expect(email).toMatchObject({
      to: 'check+site1-abc12345@check.jellycare.pt',
      from: 'wordpress@cliente.pt',
      subject: 'Novo contacto',
      receivedAt: NOW,
    })
    expect(email?.headers['authentication-results']).toContain('spf=pass')
  })

  it('lê uma entrega do Postmark', () => {
    const email = parseInboundPayload({
      To: 'check+site1-abc12345@check.jellycare.pt',
      From: 'site@cliente.pt',
      Subject: 'Contacto',
      TextBody: 'Referência do teste: abc12345',
      Headers: { 'Authentication-Results': 'mx; spf=pass' },
    })

    expect(email?.to).toContain('check+site1')
    expect(email?.text).toContain('abc12345')
  })

  it('devolve nulo sem destinatário', () => {
    expect(parseInboundPayload({ subject: 'Olá' })).toBeNull()
  })

  it('usa a hora de receção quando o fornecedor não manda carimbo', () => {
    const receivedAt = new Date('2026-09-17T11:00:00Z')
    const email = parseInboundPayload({ to: 'check@check.jellycare.pt' }, receivedAt)
    expect(email?.receivedAt).toEqual(receivedAt)
  })

  it('lê o veredito de spam do fornecedor', () => {
    expect(
      parseInboundPayload({ to: 'x@y.pt', 'spam-verdict': 'FAIL' })?.spamVerdict,
    ).toBe('fail')
    expect(parseInboundPayload({ to: 'x@y.pt', spamVerdict: 'pass' })?.spamVerdict).toBe('pass')
  })

  it('cai para o cabeçalho X-Spam-Flag quando não há veredito explícito', () => {
    const email = parseInboundPayload({
      to: 'x@y.pt',
      'message-headers': [['X-Spam-Flag', 'YES']],
    })

    expect(email?.spamVerdict).toBe('fail')
  })

  it('lê a pontuação de spam quando existe', () => {
    expect(parseInboundPayload({ to: 'x@y.pt', 'spam-score': '7.4' })?.spamScore).toBe(7.4)
    expect(parseInboundPayload({ to: 'x@y.pt', 'spam-score': 'n/a' })?.spamScore).toBeUndefined()
  })
})
