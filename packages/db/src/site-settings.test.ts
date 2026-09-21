import { describe, expect, it } from 'vitest'
import { parseSiteSettings } from './site-settings.js'

const BASE = { label: 'Site', expectedContent: '', recipients: '', slaTarget: '99.9' }

describe('parseSiteSettings', () => {
  it('aceita destinatários separados por linha, vírgula ou ponto e vírgula', () => {
    // Quem cola uma lista de emails não a formata primeiro.
    const { settings } = parseSiteSettings({
      ...BASE,
      recipients: 'a@cliente.pt\nb@cliente.pt, c@cliente.pt; d@cliente.pt',
    })

    expect(settings?.reportRecipients).toEqual([
      'a@cliente.pt',
      'b@cliente.pt',
      'c@cliente.pt',
      'd@cliente.pt',
    ])
  })

  it('não repete o mesmo destinatário', () => {
    const { settings } = parseSiteSettings({ ...BASE, recipients: 'a@b.pt\na@b.pt' })
    expect(settings?.reportRecipients).toEqual(['a@b.pt'])
  })

  it('recusa um email mal escrito em vez de o ignorar', () => {
    // Ignorar em silêncio fazia o cliente ficar sem relatório sem ninguém
    // perceber porquê.
    const { error } = parseSiteSettings({ ...BASE, recipients: 'a@b.pt\nsem-arroba' })
    expect(error).toContain('sem-arroba')
  })

  it('recusa um nome vazio', () => {
    expect(parseSiteSettings({ ...BASE, label: '   ' }).error).toBeDefined()
  })

  it('aceita SLA com vírgula decimal, que é como se escreve em português', () => {
    expect(parseSiteSettings({ ...BASE, slaTarget: '99,95' }).settings?.slaTarget).toBe(99.95)
  })

  it('apanha o engano de escrever 9,9 em vez de 99,9', () => {
    expect(parseSiteSettings({ ...BASE, slaTarget: '9.9' }).error).toContain('50 e 100')
    expect(parseSiteSettings({ ...BASE, slaTarget: '150' }).error).toBeDefined()
  })

  it('conteúdo esperado vazio fica nulo e não string vazia', () => {
    // Uma string vazia fazia o check de conteúdo procurar "" em toda a página
    // e dar sempre positivo.
    expect(parseSiteSettings({ ...BASE, expectedContent: '  ' }).settings?.expectedContent).toBeNull()
  })
})
