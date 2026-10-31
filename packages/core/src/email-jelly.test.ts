import { describe, expect, it } from 'vitest'
import { montarEmailJelly } from './email-jelly.js'

const BASE = {
  titulo: 'Tem acesso à Jellycare',
  origem: 'https://jellycare.pt',
  marca: 'jellycare' as const,
  paragrafos: ['Primeiro parágrafo.', 'Segundo\ncom quebra.'],
  rodape: 'Recebeu isto porque sim.',
}

describe('montarEmailJelly', () => {
  it('põe o wordmark em PNG servido pela aplicação, com texto alternativo', () => {
    const html = montarEmailJelly(BASE)
    expect(html).toContain('src="https://jellycare.pt/email/jellycare.png"')
    expect(html).toContain('alt="Jellycare"')
    expect(html).not.toContain('<svg')

    expect(montarEmailJelly({ ...BASE, marca: 'jelly' })).toContain('src="https://jellycare.pt/email/jelly.png"')
  })

  it('escapa tudo o que recebe, incluindo o endereço do botão', () => {
    const html = montarEmailJelly({
      ...BASE,
      paragrafos: ['<script>x</script> & y'],
      botao: { texto: 'Entrar', url: 'https://jellycare.pt/a?b=1&c="2"' },
      eyebrow: '<b>',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; y')
    expect(html).toContain('href="https://jellycare.pt/a?b=1&amp;c=&quot;2&quot;"')
    expect(html).toContain('&lt;b&gt;')
  })

  it('um parágrafo por bloco, e as quebras simples ficam', () => {
    const html = montarEmailJelly(BASE)
    expect(html.match(/<p style="margin:0 0 16px/g)).toHaveLength(2)
    expect(html).toContain('Segundo<br>com quebra.')
  })
})
