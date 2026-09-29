import { AssistenteIndisponivel, descreverErro, redigirAviso } from '@jellycare/assistant'
import { explicacaoDe } from '@jellycare/core'
import { NextResponse, type NextRequest } from 'next/server'
import { problemaParaQuemGere } from '@/lib/assistente'
import { sugestoesDeDestinatarios } from '@/lib/aviso'

export const dynamic = 'force-dynamic'

/** O que a pessoa pode pedir de específico ao rascunho. Acima disto é escrever o email à mão. */
const MAX_INSTRUCOES = 1000

/**
 * Um rascunho de aviso ao cliente. Não envia nada.
 *
 * Devolve assunto, corpo e as pessoas do cliente a quem faz sentido enviar —
 * quem tem acesso ao portal e quem recebe o relatório — para o formulário de
 * revisão abrir já preenchido. Quem decide o que sai, e para
 * quem, é a pessoa que o lê a seguir.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ findingId: string }> },
): Promise<NextResponse> {
  const { findingId } = await params
  const agora = new Date()

  const acesso = await problemaParaQuemGere(findingId, agora)
  if (acesso === null) return NextResponse.json({ error: 'nao_autenticado' }, { status: 401 })
  if (acesso === 'nao_encontrado') {
    return NextResponse.json({ error: 'nao_encontrado' }, { status: 404 })
  }

  const corpo = (await request.json().catch(() => ({}))) as { instrucoes?: unknown }
  const instrucoes = typeof corpo.instrucoes === 'string' ? corpo.instrucoes.trim() : ''
  if (instrucoes.length > MAX_INSTRUCOES) {
    return NextResponse.json({ error: 'instrucoes_demasiado_longas' }, { status: 400 })
  }

  const { problema } = acesso
  try {
    const [rascunho, sugestoes] = await Promise.all([
      redigirAviso({
        contexto: problema.contexto,
        explicacao: explicacaoDe(problema.contexto.problema.code) ?? undefined,
        instrucoes,
        agora,
      }),
      sugestoesDeDestinatarios(problema.siteId, problema.organizationId),
    ])

    // Todos os sugeridos vêm já escolhidos: são as pessoas do cliente. Quem
    // revê tira os que não interessam — é mais fácil ver quem está a mais do
    // que lembrar-se de quem falta.
    return NextResponse.json(
      {
        assunto: rascunho.assunto,
        corpo: rascunho.corpo,
        destinatarios: sugestoes.map((sugestao) => sugestao.email),
        sugestoes,
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (erro) {
    const estado = erro instanceof AssistenteIndisponivel ? 503 : 502
    console.error('[aviso] rascunho falhou', erro)
    return NextResponse.json(
      { error: 'rascunho_falhou', detalhe: descreverErro(erro) },
      { status: estado },
    )
  }
}
