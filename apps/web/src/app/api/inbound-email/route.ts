import { recordCanaryDelivery } from '@jellycare/db'
import {
  assessDelivery,
  extractCanaryReference,
  parseInboundPayload,
  verifyInboundSignature,
  type SignatureScheme,
} from '@jellycare/forms'
import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * Receção do email da caixa de verificação.
 *
 * Fecha o circuito do teste de formulários: a submissão diz que o site aceitou
 * o pedido, e só a chegada desta notificação prova que alguém o vai mesmo
 * receber.
 *
 * Configuração no fornecedor de inbox: uma rota que reencaminhe tudo o que
 * chega a CANARY_EMAIL_DOMAIN para este endpoint, assinado com
 * CANARY_INBOX_WEBHOOK_SECRET.
 */

export const dynamic = 'force-dynamic'

function scheme(request: NextRequest): SignatureScheme {
  return request.headers.get('x-jellycare-signature') ? 'jellycare' : 'mailgun'
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CANARY_INBOX_WEBHOOK_SECRET
  if (!secret) {
    // Sem segredo configurado não se aceita nada: um endpoint aberto deixaria
    // qualquer pessoa declarar que as notificações de um site funcionam.
    return NextResponse.json({ error: 'inbox_nao_configurada' }, { status: 503 })
  }

  const rawBody = await request.text()

  let payload: Record<string, unknown>
  try {
    payload = rawBody.trim().startsWith('{')
      ? (JSON.parse(rawBody) as Record<string, unknown>)
      : Object.fromEntries(new URLSearchParams(rawBody))
  } catch {
    return NextResponse.json({ error: 'corpo_invalido' }, { status: 400 })
  }

  const chosen = scheme(request)
  const verdict = verifyInboundSignature({
    scheme: chosen,
    secret,
    rawBody,
    signature:
      request.headers.get('x-jellycare-signature') ??
      (typeof payload['signature'] === 'string' ? payload['signature'] : ''),
    timestamp:
      request.headers.get('x-jellycare-timestamp') ??
      (typeof payload['timestamp'] === 'string' ? payload['timestamp'] : ''),
    ...(typeof payload['token'] === 'string' ? { token: payload['token'] } : {}),
  })

  if (!verdict.valid) {
    return NextResponse.json({ error: `assinatura_${verdict.reason}` }, { status: 401 })
  }

  const email = parseInboundPayload(payload)
  if (!email) return NextResponse.json({ error: 'sem_destinatario' }, { status: 400 })

  const reference = extractCanaryReference(email)
  // Uma mensagem sem referência é email humano dirigido à caixa de
  // verificação. Aceita-se e ignora-se: devolver erro faria o fornecedor
  // insistir indefinidamente.
  if (!reference) return NextResponse.json({ status: 'ignorado' }, { status: 202 })

  const db = getDb()
  const runs = await db.query.formRuns.findFirst({
    where: (table, { eq }) => eq(table.canaryToken, reference.token),
    columns: { startedAt: true },
  })

  if (!runs) return NextResponse.json({ status: 'desconhecido' }, { status: 202 })

  const assessment = assessDelivery(email, runs.startedAt)

  const outcome = await recordCanaryDelivery(db, {
    token: reference.token,
    receivedAt: email.receivedAt,
    latencyMs: assessment.latencyMs,
    spf: assessment.auth.spf,
    dkim: assessment.auth.dkim,
    dmarc: assessment.auth.dmarc,
    landedInSpam: assessment.landedInSpam,
  })

  if (outcome.status === 'unknown_token') {
    return NextResponse.json({ status: 'desconhecido' }, { status: 202 })
  }

  return NextResponse.json({
    status: outcome.status === 'recorded' ? 'registado' : 'ja_registado',
    latencyMs: assessment.latencyMs,
    riscos: assessment.deliverabilityRisks,
  })
}
