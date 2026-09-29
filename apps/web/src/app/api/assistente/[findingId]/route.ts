import {
  AssistenteIndisponivel,
  PRIMEIRA_PERGUNTA,
  descreverErro,
  responder,
} from '@jellycare/assistant'
import { schema } from '@jellycare/db'
import { eq } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { abrirConversa, lerConversa, lerProblemaParaAssistente } from '@/lib/assistente'
import { getDb } from '@/lib/db'
import { canManage, getCurrentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

/** Quanto pode ter uma pergunta. Acima disto é colar um ficheiro, não perguntar. */
const MAX_PERGUNTA = 2000

/**
 * Quantos turnos anteriores entram no pedido.
 *
 * Uma conversa não tem fim natural e a história inteira vai no pedido de cada
 * vez. Sem um limite, uma conversa longa deixada aberta multiplica o custo de
 * cada turno seguinte contra o histórico todo.
 */
const MAX_HISTORICO = 20

/**
 * O assistente técnico, sobre um problema concreto.
 *
 * Responde em streaming de texto simples: a primeira frase demora segundos a
 * chegar e um painel parado durante esse tempo lê-se como avaria.
 *
 * Só para a equipa. Um cliente pertence à organização e passaria na
 * verificação de pertença — por isso a verificação aqui é a de gestão, a
 * mesma que esconde a configuração do site. Este assistente fala em termos
 * técnicos, diz o que está exposto e como, e nada disso é para os olhos de
 * quem contrata o serviço.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ findingId: string }> },
): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'nao_autenticado' }, { status: 401 })

  const { findingId } = await params
  const agora = new Date()

  const problema = await lerProblemaParaAssistente(findingId, agora)
  // A mesma resposta para «não existe» e «não é seu»: confirmar a existência
  // de um problema de outro cliente já é informação a mais.
  if (!problema || !canManage(user, problema.organizationId)) {
    return NextResponse.json({ error: 'nao_encontrado' }, { status: 404 })
  }

  const corpo = (await request.json().catch(() => ({}))) as { pergunta?: unknown }
  const escrita = typeof corpo.pergunta === 'string' ? corpo.pergunta.trim() : ''
  if (escrita.length > MAX_PERGUNTA) {
    return NextResponse.json({ error: 'pergunta_demasiado_longa' }, { status: 400 })
  }

  const threadId = await abrirConversa(findingId, user.id)
  const historico = await lerConversa(threadId)
  // Vazia é o primeiro clique no botão: o que a pessoa quer é perceber aquele
  // problema, e isso é a mesma pergunta de todas as vezes.
  const pergunta = escrita || (historico.length === 0 ? PRIMEIRA_PERGUNTA : '')
  if (!pergunta) return NextResponse.json({ error: 'pergunta_vazia' }, { status: 400 })

  const db = getDb()
  await db.insert(schema.assistantMessages).values({ threadId, role: 'user', content: pergunta })

  let resposta
  try {
    resposta = responder({
      contexto: problema.contexto,
      historico: historico.slice(-MAX_HISTORICO),
      pergunta,
      agora,
    })
  } catch (erro) {
    if (erro instanceof AssistenteIndisponivel) {
      return NextResponse.json(
        { error: 'assistente_indisponivel', detalhe: erro.message },
        { status: 503 },
      )
    }
    throw erro
  }

  const encoder = new TextEncoder()
  const fluxo = new ReadableStream<Uint8Array>({
    async start(controller) {
      let texto = ''
      try {
        for await (const pedaco of resposta.pedacos) {
          texto += pedaco
          controller.enqueue(encoder.encode(pedaco))
        }
      } catch (erro) {
        // O erro vai pelo corpo e não por um estado HTTP: quando ele acontece
        // os cabeçalhos já foram enviados. Sem isto, o painel ficava a olhar
        // para uma resposta truncada sem saber que foi truncada.
        //
        // E vai com a razão dentro. A primeira versão dizia só «houve um
        // erro», o que numa ferramenta interna é o mesmo que não dizer nada:
        // quem está a ver isto é a equipa, tem de poder agir, e a alternativa
        // era ir aos registos da máquina de produção para saber se foi a
        // chave, o crédito, ou um pedido malformado.
        const aviso = `\n\n[A resposta foi interrompida: ${descreverErro(erro)}]`
        texto += aviso
        controller.enqueue(encoder.encode(aviso))
        console.error('[assistente] fluxo interrompido', erro)
      } finally {
        // Gravado mesmo quando o fluxo morre a meio ou o browser desliga: o
        // pedido já foi pago, e uma conversa que perde a resposta faz a
        // pessoa perguntar outra vez e pagar duas.
        if (texto.length > 0) {
          const consumo = resposta.consumo()
          await db.insert(schema.assistantMessages).values({
            threadId,
            role: 'assistant',
            content: texto,
            inputTokens: consumo.entrada,
            outputTokens: consumo.saida,
            cachedTokens: consumo.cache,
          })
          await db
            .update(schema.assistantThreads)
            .set({ lastMessageAt: new Date() })
            .where(eq(schema.assistantThreads.id, threadId))
        }
        controller.close()
      }
    },
  })

  return new Response(fluxo, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      // O proxy da Fly junta pedaços pequenos se não lhe disserem que não.
      'x-accel-buffering': 'no',
    },
  })
}

/** A conversa já havida, para o painel abrir onde ficou. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ findingId: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'nao_autenticado' }, { status: 401 })

  const { findingId } = await params
  const problema = await lerProblemaParaAssistente(findingId, new Date())
  if (!problema || !canManage(user, problema.organizationId)) {
    return NextResponse.json({ error: 'nao_encontrado' }, { status: 404 })
  }

  const threadId = await abrirConversa(findingId, user.id)
  return NextResponse.json({ turnos: await lerConversa(threadId) }, {
    headers: { 'cache-control': 'no-store' },
  })
}
