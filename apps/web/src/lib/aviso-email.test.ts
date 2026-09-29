import { describe, expect, it } from 'vitest'
import { destinatariosInvalidos, lerDestinatarios, montarAvisoEmail } from './aviso-email'
import { enviarPeloResend } from './aviso'

const AVISO = {
  assunto: '  O email do seu domínio precisa de uma autorização  ',
  corpo:
    'Os emails que envia a partir de acpa.pt não trazem a autorização que os servidores de destino procuram.\n\n' +
    'Precisamos que peça a quem gere o domínio que acrescente este registo:\nv=spf1 include:_spf.google.com ~all',
  site: { label: 'ACPA', url: 'https://acpa.pt' },
}

describe('montarAvisoEmail', () => {
  it('parte o corpo em parágrafos e mantém as quebras de linha dentro deles', () => {
    // Um registo DNS para reencaminhar tem de chegar numa linha própria, tal
    // como foi escrito — é para ser copiado e colado por outra pessoa.
    const { html } = montarAvisoEmail(AVISO)
    expect(html.match(/<p style="margin:0 0 16px/g)).toHaveLength(2)
    expect(html).toContain('acrescente este registo:<br>v=spf1')
  })

  it('escapa o que a pessoa escreveu', () => {
    // O corpo passou por um modelo e por uma pessoa. Nenhum dos dois devia
    // conseguir meter marcação no email.
    const { html } = montarAvisoEmail({ ...AVISO, corpo: 'Veja <script>alert(1)</script> & isto' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp; isto')
  })

  it('leva uma versão em texto com o mesmo conteúdo', () => {
    // Há clientes de email que só mostram o texto, e filtros de spam que
    // desconfiam de mensagens só com HTML.
    const { texto } = montarAvisoEmail(AVISO)
    expect(texto).toContain('v=spf1 include:_spf.google.com ~all')
    expect(texto).toContain('Equipa Jelly')
    expect(texto).not.toContain('<')
  })

  it('assina como Jelly e diz ao cliente que pode responder', () => {
    const { html, assunto } = montarAvisoEmail(AVISO)
    expect(html).toContain('Equipa Jelly')
    expect(html).toContain('Basta responder')
    expect(assunto).toBe('O email do seu domínio precisa de uma autorização')
  })
})

describe('destinatários', () => {
  it('aceita vírgulas, pontos e vírgulas e linhas, e tira repetidos', () => {
    expect(lerDestinatarios('Ana@acpa.pt, rui@acpa.pt;\nana@acpa.pt  ')).toEqual([
      'ana@acpa.pt',
      'rui@acpa.pt',
    ])
  })

  it('aponta os endereços que não são endereços', () => {
    expect(destinatariosInvalidos(['ana@acpa.pt', 'rui', 'x@y'])).toEqual(['rui', 'x@y'])
  })
})

describe('enviarPeloResend', () => {
  it('responde para quem reviu, e não para o endereço de envio', async () => {
    // A resposta de um cliente a um aviso sobre o site dele tem de chegar a
    // uma pessoa. Sem `reply_to` ia para avisos@, que ninguém lê.
    const pedidos: { url: string; corpo: Record<string, unknown>; auth: string | null }[] = []
    const fetchFalso = (async (url: string, init: RequestInit) => {
      pedidos.push({
        url,
        corpo: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get('authorization'),
      })
      return new Response('{"id":"re_1"}', { status: 200 })
    }) as unknown as typeof fetch

    await enviarPeloResend(
      { para: ['ana@acpa.pt'], responderPara: 'equipa@jelly.pt', email: montarAvisoEmail(AVISO) },
      { apiKey: 'chave', de: 'Jelly <avisos@jellycare.pt>', fetchImpl: fetchFalso },
    )

    expect(pedidos[0]!.url).toBe('https://api.resend.com/emails')
    expect(pedidos[0]!.auth).toBe('Bearer chave')
    expect(pedidos[0]!.corpo).toMatchObject({
      from: 'Jelly <avisos@jellycare.pt>',
      to: ['ana@acpa.pt'],
      reply_to: 'equipa@jelly.pt',
      subject: 'O email do seu domínio precisa de uma autorização',
    })
    expect(pedidos[0]!.corpo.html).toContain('Equipa Jelly')
    expect(pedidos[0]!.corpo.text).toContain('Equipa Jelly')
  })

  it('rebenta com o estado e a resposta quando o Resend recusa', async () => {
    const fetchFalso = (async () =>
      new Response('domain not verified', { status: 403 })) as unknown as typeof fetch

    await expect(
      enviarPeloResend(
        { para: ['ana@acpa.pt'], responderPara: 'equipa@jelly.pt', email: montarAvisoEmail(AVISO) },
        { apiKey: 'chave', de: 'Jelly <avisos@jellycare.pt>', fetchImpl: fetchFalso },
      ),
    ).rejects.toThrow(/403: domain not verified/)
  })

  it('recusa-se a enviar sem chave em vez de fingir', async () => {
    await expect(
      enviarPeloResend(
        { para: ['ana@acpa.pt'], responderPara: 'equipa@jelly.pt', email: montarAvisoEmail(AVISO) },
        { apiKey: undefined, de: 'Jelly <avisos@jellycare.pt>' },
      ),
    ).rejects.toThrow(/RESEND_API_KEY/)
  })
})
