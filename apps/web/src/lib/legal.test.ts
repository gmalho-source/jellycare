import { describe, expect, it } from 'vitest'
import { renderLegalMarkdown } from './legal.js'

describe('renderLegalMarkdown', () => {
  it('mantém ligações http, mailto, do próprio site e âncoras', () => {
    const html = renderLegalMarkdown(
      '[site](https://jellycare.pt) [mail](mailto:ola@jellycare.pt) [pagina](/legal/dpa) [anexo](#anexo)',
    )

    expect(html).toContain('href="https://jellycare.pt"')
    expect(html).toContain('href="mailto:ola@jellycare.pt"')
    expect(html).toContain('href="/legal/dpa"')
    expect(html).toContain('href="#anexo"')
  })

  it('não deixa um link javascript sobreviver', () => {
    const html = renderLegalMarkdown('[clique](javascript:alert(1))')

    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="#"')
  })

  it('não deixa HTML colado no markdown executar', () => {
    const html = renderLegalMarkdown('<script>alert(1)</script>')

    expect(html).not.toContain('<script>')
  })
})
