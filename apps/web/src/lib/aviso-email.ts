import { montarEmailJelly } from '@jellycare/core'

/**
 * O aviso ao cliente, montado como email.
 *
 * Função pura: recebe o que a pessoa reviu e devolve o HTML e o texto. Sem
 * isto, a única forma de ver como o email fica era enviá-lo a alguém.
 *
 * Com o wordmark da Jelly e não o da Jellycare: quem escreve ao cliente é a
 * agência que ele contratou, e a plataforma é a ferramenta dela. O desenho é o
 * modelo comum dos emails ao cliente (`montarEmailJelly`).
 */

export interface AvisoParaEnviar {
  assunto: string
  corpo: string
  site: { label: string; url: string }
  /** Origem da aplicação, de onde vem o logótipo. */
  origem: string
}

export interface EmailMontado {
  assunto: string
  html: string
  texto: string
}

/** Parágrafos separados por linha em branco; as quebras simples mantêm-se. */
function paragrafos(corpo: string): string[] {
  return corpo
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragrafo) => paragrafo.trim())
    .filter((paragrafo) => paragrafo.length > 0)
}

export function montarAvisoEmail(aviso: AvisoParaEnviar): EmailMontado {
  const blocos = paragrafos(aviso.corpo)
  const assunto = aviso.assunto.trim()

  const html = montarEmailJelly({
    titulo: assunto,
    origem: aviso.origem,
    marca: 'jelly',
    eyebrow: `Sobre o site ${aviso.site.label}`,
    paragrafos: blocos,
    assinatura: { nome: 'Equipa Jelly', nota: 'Basta responder a este email para falar connosco.' },
    rodape: `Enviado porque a Jelly monitoriza ${aviso.site.url}.`,
  })

  // A versão em texto não é um extra: há clientes de email que só mostram
  // essa, e filtros de spam que desconfiam de mensagens que só têm HTML.
  const texto = [
    `Sobre o site ${aviso.site.label}`,
    '',
    ...blocos.flatMap((paragrafo) => [paragrafo, '']),
    'Equipa Jelly',
    'Basta responder a este email para falar connosco.',
    '',
    `Enviado porque a Jelly monitoriza ${aviso.site.url}.`,
  ].join('\n')

  return { assunto, html, texto }
}

/** Endereços separados por vírgula, ponto e vírgula ou linha, sem repetidos. */
export function lerDestinatarios(texto: string): string[] {
  const vistos = new Set<string>()
  for (const parte of texto.split(/[\s,;]+/)) {
    const endereco = parte.trim().toLowerCase()
    if (endereco) vistos.add(endereco)
  }
  return [...vistos]
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function destinatariosInvalidos(destinatarios: string[]): string[] {
  return destinatarios.filter((endereco) => !EMAIL.test(endereco))
}
