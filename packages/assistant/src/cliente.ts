import Anthropic from '@anthropic-ai/sdk'
import { montarContexto, type ContextoDoProblema } from './contexto.js'
import { SISTEMA } from './prompt.js'

/** O modelo. Constante e não configurável por pedido: ver `MODELO` em docs/assistente.md. */
export const MODELO = 'claude-opus-5-5'

export interface TurnoDaConversa {
  role: 'user' | 'assistant'
  content: string
}

export interface ConsumoDeTokens {
  entrada: number
  saida: number
  /** Lidos da cache. Zero em pedidos repetidos quer dizer que a cache não está a pegar. */
  cache: number
}

export interface RespostaDoAssistente {
  /** Os pedaços de texto, pela ordem em que chegam. */
  pedacos: AsyncIterable<string>
  /** Só depois de o fluxo acabar. */
  consumo: () => ConsumoDeTokens
}

export class AssistenteIndisponivel extends Error {}

/**
 * O que correu mal, em texto, para quem está a olhar para o painel.
 *
 * Os erros do SDK trazem o estado HTTP e a mensagem da API, e é isso que
 * distingue «a chave está errada» de «acabou o crédito» de «o pedido ia
 * malformado». Numa superfície que só a equipa vê, esconder isso não protege
 * ninguém — só obriga a ir aos registos da máquina de produção para saber
 * porque é que o painel disse «houve um erro».
 *
 * Vive aqui e não na aplicação web porque é aqui que o SDK vive: o painel não
 * tem de saber que existe uma Anthropic do outro lado.
 */
export function descreverErro(erro: unknown): string {
  if (erro instanceof Anthropic.APIError) {
    return `a API respondeu ${erro.status ?? '?'} — ${erro.message}`
  }
  if (erro instanceof Error) return erro.message
  return String(erro)
}

/**
 * Uma resposta do assistente, em streaming.
 *
 * O contexto do problema vai numa mensagem do utilizador e não no prompt de
 * sistema. São duas razões: o prompt de sistema é o prefixo que a cache
 * aproveita e tem de ser byte a byte igual entre pedidos, e o contexto muda a
 * cada turno porque é remontado a partir da base de dados — um problema que
 * agravou entretanto tem de entrar na conversa como está agora.
 *
 * O streaming não é enfeite: a primeira frase demora segundos a chegar e um
 * painel parado durante esse tempo lê-se como avaria.
 */
export function responder(options: {
  contexto: ContextoDoProblema
  /** A conversa até aqui, sem o turno novo. */
  historico: TurnoDaConversa[]
  pergunta: string
  agora: Date
  apiKey?: string | undefined
  cliente?: Anthropic | undefined
}): RespostaDoAssistente {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!options.cliente && !apiKey) {
    throw new AssistenteIndisponivel(
      'ANTHROPIC_API_KEY não está configurado nesta aplicação.',
    )
  }

  const cliente = options.cliente ?? new Anthropic({ apiKey })

  const mensagens: Anthropic.MessageParam[] = [
    ...options.historico.map((turno) => ({ role: turno.role, content: turno.content })),
    {
      role: 'user' as const,
      content: `Contexto atual deste problema:\n\n${montarContexto(options.contexto, options.agora)}\n\n${options.pergunta}`,
    },
  ]

  let consumo: ConsumoDeTokens = { entrada: 0, saida: 0, cache: 0 }

  async function* pedacos(): AsyncIterable<string> {
    const fluxo = cliente.messages.stream({
      model: MODELO,
      max_tokens: 16_000,
      // O prompt de sistema é grande e nunca muda: é exatamente o que a cache
      // serve a um décimo do preço, e o que torna uma conversa de vários
      // turnos barata em vez de cara.
      system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
      // `low` porque isto é uma explicação técnica sobre evidência que já lhe
      // é dada, e não um problema por resolver de raiz. Sobe-se se as
      // respostas ficarem rasas; descer mais não deixa margem.
      output_config: { effort: 'low' },
      messages: mensagens,
    })

    for await (const evento of fluxo) {
      if (evento.type === 'content_block_delta' && evento.delta.type === 'text_delta') {
        yield evento.delta.text
      }
    }

    const final = await fluxo.finalMessage()
    consumo = {
      entrada: final.usage.input_tokens,
      saida: final.usage.output_tokens,
      cache: final.usage.cache_read_input_tokens ?? 0,
    }
  }

  return { pedacos: pedacos(), consumo: () => consumo }
}
