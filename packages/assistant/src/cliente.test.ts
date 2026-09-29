import { describe, expect, it } from 'vitest'
import type { ContextoDoProblema } from './contexto.js'
import { AssistenteIndisponivel, responder } from './cliente.js'

const AGORA = new Date('2026-09-29T10:00:00Z')

const CONTEXTO: ContextoDoProblema = {
  site: {
    label: 'ACPA',
    url: 'https://acpa.pt',
    hostname: 'acpa.pt',
    verified: true,
    state: 'active',
  },
  problema: {
    code: 'missing_hsts',
    checkType: 'security_headers',
    title: 'Falta o header Strict-Transport-Security',
    detail: null,
    severity: 'medium',
    state: 'open',
    evidence: null,
    firstSeenAt: new Date('2026-09-21T10:00:00Z'),
    lastSeenAt: new Date('2026-09-29T08:00:00Z'),
    occurrences: 8,
  },
  execucoes: [],
  wordpress: null,
  emManutencao: false,
}

/**
 * Um Claude de mentira.
 *
 * Guarda o pedido para se poder afirmar coisas sobre ele, e devolve um fluxo
 * com dois pedaços. Serve para provar a forma do pedido sem gastar dinheiro
 * nem depender da rede — o que a API responde não é o que estes testes
 * verificam.
 */
function clienteFalso(texto = ['Primeiro ', 'pedaço.']) {
  const pedidos: Record<string, unknown>[] = []
  const cliente = {
    messages: {
      stream(pedido: Record<string, unknown>) {
        pedidos.push(pedido)
        return {
          async *[Symbol.asyncIterator]() {
            for (const parte of texto) {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: parte } }
            }
          },
          finalMessage: async () => ({
            usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 900 },
          }),
        }
      },
    },
  }
  return { cliente, pedidos }
}

async function juntar(pedacos: AsyncIterable<string>): Promise<string> {
  let texto = ''
  for await (const pedaco of pedacos) texto += pedaco
  return texto
}

describe('responder', () => {
  it('recusa-se a fingir quando não há chave configurada', async () => {
    // Sem chave, a alternativa era um erro genérico da API a meio do fluxo,
    // já com o painel aberto e o utilizador à espera.
    const semChave = { ...process.env }
    delete process.env.ANTHROPIC_API_KEY
    try {
      expect(() =>
        responder({ contexto: CONTEXTO, historico: [], pergunta: 'olá', agora: AGORA }),
      ).toThrow(AssistenteIndisponivel)
    } finally {
      process.env = semChave
    }
  })

  it('devolve o texto em pedaços e só depois o consumo', async () => {
    const { cliente } = clienteFalso(['Falta ', 'o HSTS.'])
    const resposta = responder({
      contexto: CONTEXTO,
      historico: [],
      pergunta: 'Explica.',
      agora: AGORA,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cliente: cliente as any,
    })

    // Antes de o fluxo acabar não há números para dar, e dar zeros seria pior
    // do que não dar nada: entravam na base de dados como consumo real.
    expect(resposta.consumo()).toEqual({ entrada: 0, saida: 0, cache: 0 })
    expect(await juntar(resposta.pedacos)).toBe('Falta o HSTS.')
    expect(resposta.consumo()).toEqual({ entrada: 1200, saida: 300, cache: 900 })
  })

  it('marca o prompt de sistema para cache e deixa-o fora das mensagens', async () => {
    // É o que faz uma conversa de vários turnos custar cêntimos em vez de
    // euros. Se alguém mover o prompt para dentro das mensagens, ou lhe tirar
    // o `cache_control`, a conta multiplica-se em silêncio.
    const { cliente, pedidos } = clienteFalso()
    const resposta = responder({
      contexto: CONTEXTO,
      historico: [],
      pergunta: 'Explica.',
      agora: AGORA,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cliente: cliente as any,
    })
    await juntar(resposta.pedacos)

    const pedido = pedidos[0]!
    const sistema = pedido.system as { text: string; cache_control?: unknown }[]
    expect(sistema[0]!.cache_control).toEqual({ type: 'ephemeral' })
    expect(sistema[0]!.text).toContain('Jellycare')
  })

  it('põe o contexto no turno do utilizador e não no prompt de sistema', async () => {
    // O contexto é remontado a cada pedido a partir da base de dados, porque
    // um problema que agravou entretanto tem de entrar como está agora. Se
    // fosse para o prompt de sistema, mudava o prefixo e matava a cache a
    // cada turno.
    const { cliente, pedidos } = clienteFalso()
    const resposta = responder({
      contexto: CONTEXTO,
      historico: [{ role: 'user', content: 'antes' }, { role: 'assistant', content: 'resposta' }],
      pergunta: 'E agora?',
      agora: AGORA,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cliente: cliente as any,
    })
    await juntar(resposta.pedacos)

    const mensagens = pedidos[0]!.messages as { role: string; content: string }[]
    expect(mensagens).toHaveLength(3)
    expect(mensagens[0]).toEqual({ role: 'user', content: 'antes' })
    expect(mensagens[2]!.role).toBe('user')
    expect(mensagens[2]!.content).toContain('missing_hsts')
    expect(mensagens[2]!.content).toContain('E agora?')

    const sistema = pedidos[0]!.system as { text: string }[]
    expect(sistema[0]!.text).not.toContain('missing_hsts')
  })
})
