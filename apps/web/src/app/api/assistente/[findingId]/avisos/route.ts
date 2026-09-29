import { NextResponse, type NextRequest } from 'next/server'
import { problemaParaQuemGere } from '@/lib/assistente'
import { destinatariosInvalidos, lerDestinatarios, montarAvisoEmail } from '@/lib/aviso-email'
import { lerAvisos, registarEEnviar } from '@/lib/aviso'

export const dynamic = 'force-dynamic'

const MAX_ASSUNTO = 200
const MAX_CORPO = 10_000
/** Um aviso vai para o contacto do cliente, não para uma lista de distribuição. */
const MAX_DESTINATARIOS = 10

/** Os avisos já tentados sobre este problema: o registo que a equipa consulta. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ findingId: string }> },
): Promise<NextResponse> {
  const { findingId } = await params
  const acesso = await problemaParaQuemGere(findingId, new Date())
  if (acesso === null) return NextResponse.json({ error: 'nao_autenticado' }, { status: 401 })
  if (acesso === 'nao_encontrado') {
    return NextResponse.json({ error: 'nao_encontrado' }, { status: 404 })
  }

  return NextResponse.json(
    { avisos: await lerAvisos(findingId) },
    { headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * Envia um aviso já revisto.
 *
 * Só aceita o que vem do formulário: assunto, corpo e destinatários tal como a
 * pessoa os deixou. Não há caminho daqui para o modelo — o que sai é o que foi
 * lido, e é isso que fica registado.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ findingId: string }> },
): Promise<NextResponse> {
  const { findingId } = await params
  const acesso = await problemaParaQuemGere(findingId, new Date())
  if (acesso === null) return NextResponse.json({ error: 'nao_autenticado' }, { status: 401 })
  if (acesso === 'nao_encontrado') {
    return NextResponse.json({ error: 'nao_encontrado' }, { status: 404 })
  }

  const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const assunto = typeof corpo.assunto === 'string' ? corpo.assunto.trim() : ''
  const texto = typeof corpo.corpo === 'string' ? corpo.corpo.trim() : ''
  // Uma lista do formulário, ou texto separado por vírgulas para quem chame
  // isto à mão. Os dois passam pela mesma limpeza e pela mesma validação.
  const destinatarios = lerDestinatarios(
    Array.isArray(corpo.destinatarios)
      ? corpo.destinatarios.filter((item): item is string => typeof item === 'string').join(',')
      : typeof corpo.destinatarios === 'string'
        ? corpo.destinatarios
        : '',
  )

  if (!assunto || assunto.length > MAX_ASSUNTO) {
    return NextResponse.json(
      { error: 'assunto_invalido', detalhe: 'O assunto está vazio ou demasiado longo.' },
      { status: 400 },
    )
  }
  if (!texto || texto.length > MAX_CORPO) {
    return NextResponse.json(
      { error: 'corpo_invalido', detalhe: 'O texto está vazio ou demasiado longo.' },
      { status: 400 },
    )
  }
  if (destinatarios.length === 0) {
    return NextResponse.json(
      { error: 'sem_destinatarios', detalhe: 'Indique pelo menos um destinatário.' },
      { status: 400 },
    )
  }
  if (destinatarios.length > MAX_DESTINATARIOS) {
    return NextResponse.json(
      { error: 'destinatarios_a_mais', detalhe: `No máximo ${MAX_DESTINATARIOS} destinatários.` },
      { status: 400 },
    )
  }
  const invalidos = destinatariosInvalidos(destinatarios)
  if (invalidos.length > 0) {
    return NextResponse.json(
      {
        error: 'destinatarios_invalidos',
        detalhe: `Endereços inválidos: ${invalidos.join(', ')}`,
      },
      { status: 400 },
    )
  }

  const { user, problema } = acesso
  const email = montarAvisoEmail({
    assunto,
    corpo: texto,
    site: { label: problema.contexto.site.label, url: problema.contexto.site.url },
  })

  const resultado = await registarEEnviar({
    findingId,
    userId: user.id,
    destinatarios,
    responderPara: user.email,
    email,
    corpo: texto,
  })

  if (!resultado.ok) {
    // Fica registado com o erro, e a pessoa vê porquê. Não se tenta outra vez
    // sozinho: um reenvio automático a um cliente é o tipo de coisa que acaba
    // com o mesmo email na caixa dele três vezes.
    return NextResponse.json(
      { error: 'envio_falhou', detalhe: resultado.erro, id: resultado.id },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, id: resultado.id })
}
