import { describe, expect, it } from 'vitest'
import type { ContextoDoProblema } from './contexto.js'
import { redigirAviso } from './aviso.js'

const AGORA = new Date('2026-09-29T10:00:00Z')

const CONTEXTO: ContextoDoProblema = {
  site: { label: 'ACPA', url: 'https://acpa.pt', hostname: 'acpa.pt', verified: true, state: 'active' },
  problema: {
    code: 'spf_missing',
    checkType: 'email_auth',
    title: 'O domínio não tem registo SPF',
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

const EXPLICACAO = {
  titulo: 'Falta a autorização de quem pode enviar email pelo domínio',
  oQueE: 'O SPF é o registo que diz quais os servidores autorizados a enviar email.',
  porqueImporta: 'Sem ele, qualquer pessoa pode enviar email que aparenta vir do seu domínio.',
  oQueFazemos: 'Publicamos o registo com os serviços que envia mesmo em seu nome.',
}

function clienteFalso() {
  const pedidos: Record<string, unknown>[] = []
  const cliente = {
    messages: {
      async parse(pedido: Record<string, unknown>) {
        pedidos.push(pedido)
        return {
          parsed_output: { assunto: 'Uma coisa a tratar no seu site', corpo: 'Olá.' },
          usage: { input_tokens: 900, output_tokens: 200, cache_read_input_tokens: 700 },
        }
      },
    },
  }
  return { cliente, pedidos }
}

describe('redigirAviso', () => {
  it('ancora o texto na explicação já revista', async () => {
    // Sem âncora, o modelo reinventa o que o problema é a cada rascunho, e o
    // email deixa de dizer o mesmo que o cliente lê no portal. Com ela,
    // reescreve para esta situação em vez de inventar de novo.
    const { cliente, pedidos } = clienteFalso()
    await redigirAviso({
      contexto: CONTEXTO,
      explicacao: EXPLICACAO,
      agora: AGORA,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cliente: cliente as any,
    })

    const mensagem = (pedidos[0]!.messages as { content: string }[])[0]!.content
    expect(mensagem).toContain(EXPLICACAO.oQueE)
    expect(mensagem).toContain(EXPLICACAO.oQueFazemos)
    // E o contexto do site concreto vai atrás.
    expect(mensagem).toContain('spf_missing')
    expect(mensagem).toContain('acpa.pt')
  })

  it('devolve assunto e corpo separados, com o consumo', async () => {
    const { cliente } = clienteFalso()
    const aviso = await redigirAviso({
      contexto: CONTEXTO,
      agora: AGORA,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cliente: cliente as any,
    })

    expect(aviso.assunto).toBe('Uma coisa a tratar no seu site')
    expect(aviso.corpo).toBe('Olá.')
    expect(aviso.consumo).toEqual({ entrada: 900, saida: 200, cache: 700 })
  })

  it('leva as instruções de quem vai rever', async () => {
    const { cliente, pedidos } = clienteFalso()
    await redigirAviso({
      contexto: CONTEXTO,
      instrucoes: 'Diz que já falámos disto ao telefone.',
      agora: AGORA,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cliente: cliente as any,
    })

    const mensagem = (pedidos[0]!.messages as { content: string }[])[0]!.content
    expect(mensagem).toContain('já falámos disto ao telefone')
  })

  it('não inventa um aviso quando o modelo não devolve um', async () => {
    // `parsed_output` vem a null quando a saída não bate certo com a forma
    // pedida. Deixar passar punha uma caixa vazia à frente de quem ia rever,
    // sem dizer que não houve rascunho nenhum.
    const cliente = {
      messages: {
        async parse() {
          return { parsed_output: null, usage: { input_tokens: 0, output_tokens: 0 } }
        },
      },
    }

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redigirAviso({ contexto: CONTEXTO, agora: AGORA, cliente: cliente as any }),
    ).rejects.toThrow(/não devolveu/)
  })
})
