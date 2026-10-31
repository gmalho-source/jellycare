/**
 * O modelo dos emails que o cliente recebe, com a marca Jelly.
 *
 * Um só, para os avisos, o relatório mensal e o convite para o portal: quem
 * recebe três emails nossos não deve ver três desenhos diferentes. Segue o
 * Jelly Design System, contido: faixa ink com o wordmark, cartão branco de
 * 20px sobre o papel #f4f6f8, Poppins quando o cliente de email a carrega
 * (Apple Mail, iOS) e Helvetica quando não, eyebrow vermelha. Um email com cor
 * a mais lê-se como publicidade e vai para a pasta errada.
 *
 * Tabelas e estilos em linha porque é o que os clientes de email respeitam: o
 * Outlook ignora metade do CSS moderno e o Gmail apaga as folhas de estilo. O
 * logótipo é PNG, servido pela aplicação: SVG num email não se vê no Gmail nem
 * no Outlook. Com as imagens bloqueadas fica o texto alternativo, a branco
 * sobre a faixa.
 *
 * Função pura, sem dependências, para o painel e o worker usarem o mesmo.
 */

export interface EmailJelly {
  /** O `<title>` e, por omissão, a pré-visualização na caixa de entrada. */
  titulo: string
  /** O texto que a caixa de entrada mostra ao lado do assunto. */
  previa?: string
  /** Origem da aplicação, para o endereço do logótipo. Sem barra no fim. */
  origem: string
  /** Que wordmark vai na faixa: a agência (avisos) ou o produto. */
  marca: 'jelly' | 'jellycare'
  /** A linha pequena em maiúsculas por cima do texto. */
  eyebrow?: string
  /** Parágrafos em texto simples. Escapados aqui; uma quebra simples fica `<br>`. */
  paragrafos: string[]
  botao?: { texto: string; url: string }
  assinatura?: { nome: string; nota?: string }
  /** A linha cinzenta por baixo do cartão: porque é que a pessoa recebeu isto. */
  rodape: string
}

const INK = '#151719'
const SLATE = '#2a384a'
const MUTED = '#5c6878'
const PAPEL = '#f4f6f8'
/** O vermelho que passa 4,5:1 em branco, para texto e para o botão. */
const VERMELHO = '#c42a3d'
const FONTE = "'Poppins', Helvetica, Arial, sans-serif"

const LOGOS = {
  jelly: { ficheiro: 'jelly.png', alt: 'Jelly', largura: 74 },
  jellycare: { ficheiro: 'jellycare.png', alt: 'Jellycare', largura: 121 },
} as const

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function montarEmailJelly(email: EmailJelly): string {
  const logo = LOGOS[email.marca]
  const previa = email.previa ?? email.titulo

  const paragrafos = email.paragrafos
    .map(
      (paragrafo) =>
        `<p style="margin:0 0 16px;font-family:${FONTE};font-size:15px;line-height:1.6;color:${INK};">${escaparHtml(
          paragrafo,
        ).replace(/\n/g, '<br>')}</p>`,
    )
    .join('')

  const botao = email.botao
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
              <tr>
                <td style="background:${VERMELHO};border-radius:8px;">
                  <a href="${escaparHtml(email.botao.url)}" style="display:inline-block;padding:12px 20px;font-family:${FONTE};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escaparHtml(
                    email.botao.texto,
                  )} &rarr;</a>
                </td>
              </tr>
            </table>`
    : ''

  const assinatura = email.assinatura
    ? `<p style="margin:8px 0 0;font-family:${FONTE};font-size:15px;line-height:1.6;color:${INK};">${escaparHtml(
        email.assinatura.nome,
      )}</p>${
        email.assinatura.nota
          ? `<p style="margin:4px 0 0;font-family:${FONTE};font-size:13px;line-height:1.5;color:${MUTED};">${escaparHtml(
              email.assinatura.nota,
            )}</p>`
          : ''
      }`
    : ''

  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escaparHtml(email.titulo)}</title>
<style>
  @font-face { font-family: 'Poppins'; font-weight: 400; src: url('${email.origem}/fonts/poppins-400-latin.woff2') format('woff2'); }
  @font-face { font-family: 'Poppins'; font-weight: 600; src: url('${email.origem}/fonts/poppins-600-latin.woff2') format('woff2'); }
</style>
</head>
<body style="margin:0;padding:0;background:${PAPEL};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escaparHtml(previa)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPEL};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr>
          <td style="background:${INK};border-radius:20px 20px 0 0;padding:22px 32px;">
            <img src="${email.origem}/email/${logo.ficheiro}" width="${logo.largura}" height="28" alt="${logo.alt}" style="display:block;border:0;height:28px;width:${logo.largura}px;color:#ffffff;font-family:${FONTE};font-size:20px;font-weight:600;">
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-radius:0 0 20px 20px;padding:28px 32px;">
            ${
              email.eyebrow
                ? `<p style="margin:0 0 14px;font-family:${FONTE};font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${VERMELHO};">${escaparHtml(
                    email.eyebrow,
                  )}</p>`
                : ''
            }
            ${paragrafos}
            ${botao}
            ${assinatura}
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;max-width:560px;font-family:${FONTE};font-size:12px;line-height:1.5;color:${SLATE};">${escaparHtml(
        email.rodape,
      )}</p>
    </td>
  </tr>
</table>
</body>
</html>`
}
