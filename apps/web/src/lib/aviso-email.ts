/**
 * O aviso ao cliente, montado como email.
 *
 * Função pura: recebe o que a pessoa reviu e devolve o HTML e o texto. Sem
 * isto, a única forma de ver como o email fica era enviá-lo a alguém.
 *
 * O estilo é o da Jelly e não o da Jellycare: quem escreve ao cliente é a
 * agência que ele contratou, e a plataforma é a ferramenta dela. Contido de
 * propósito — um aviso sobre um problema no site não é uma newsletter, e um
 * email carregado de cor lê-se como publicidade e vai para a pasta errada.
 *
 * Tabelas e estilos em linha porque é o que os clientes de email respeitam. O
 * Outlook ignora metade do CSS moderno e o Gmail apaga as folhas de estilo.
 */

export interface AvisoParaEnviar {
  assunto: string
  corpo: string
  site: { label: string; url: string }
}

export interface EmailMontado {
  assunto: string
  html: string
  texto: string
}

const VERMELHO = '#c42a3d'
const TINTA = '#16161a'
const TINTA_SUAVE = '#55555f'
const FUNDO = '#f6f5f3'

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

  const corpoHtml = blocos
    .map(
      (paragrafo) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TINTA};">${escapar(
          paragrafo,
        ).replace(/\n/g, '<br>')}</p>`,
    )
    .join('')

  const html = `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(aviso.assunto)}</title>
</head>
<body style="margin:0;padding:0;background:${FUNDO};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FUNDO};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;">
        <tr>
          <td style="padding:28px 32px 8px;">
            <span style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${TINTA};">Jelly</span><span style="font-size:22px;font-weight:700;color:${VERMELHO};">.</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 0;">
            <p style="margin:0 0 20px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${TINTA_SUAVE};">
              Sobre o site ${escapar(aviso.site.label)}
            </p>
            ${corpoHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 28px;">
            <p style="margin:0;font-size:15px;line-height:1.6;color:${TINTA};">Equipa Jelly</p>
            <p style="margin:4px 0 0;font-size:13px;line-height:1.5;color:${TINTA_SUAVE};">
              Basta responder a este email para falar connosco.
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${TINTA_SUAVE};">
        Enviado porque a Jelly monitoriza ${escapar(aviso.site.url)}.
      </p>
    </td>
  </tr>
</table>
</body>
</html>`

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

  return { assunto: aviso.assunto.trim(), html, texto }
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
