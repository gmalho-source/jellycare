import { describe, expect, it } from 'vitest'
import { isDeclaredPage, MAX_FORM_TEST_URLS, parseFormTestUrls } from './form-test-urls.js'

const SITE = 'https://cliente.pt'

describe('parseFormTestUrls', () => {
  it('aceita um caminho relativo e devolve-o absoluto', () => {
    // Quem está no painel do site pensa em páginas, não em endereços.
    const { urls } = parseFormTestUrls(['/contactos'], SITE)
    expect(urls).toEqual(['https://cliente.pt/contactos'])
  })

  it('aceita o URL completo', () => {
    const { urls } = parseFormTestUrls(['https://cliente.pt/orcamento'], SITE)
    expect(urls).toEqual(['https://cliente.pt/orcamento'])
  })

  it('recusa páginas de outro domínio, em vez de as ignorar', () => {
    // Ou houve engano no site, ou alguém nos pediu para submeter formulários
    // em casa alheia. Nenhuma das duas merece silêncio.
    const { urls, rejected } = parseFormTestUrls(['https://outro.pt/contacto'], SITE)
    expect(urls).toEqual([])
    expect(rejected[0]?.reason).toContain('cliente.pt')
  })

  it('recusa o que não é http nem https', () => {
    const { urls, rejected } = parseFormTestUrls(['javascript:alert(1)', 'mailto:a@b.pt'], SITE)
    expect(urls).toEqual([])
    expect(rejected).toHaveLength(2)
  })

  it('ignora linhas vazias sem as tratar como erro', () => {
    const { urls, rejected } = parseFormTestUrls(['', '  ', '/contactos'], SITE)
    expect(urls).toEqual(['https://cliente.pt/contactos'])
    expect(rejected).toEqual([])
  })

  it('não repete a mesma página escrita de duas maneiras', () => {
    const { urls } = parseFormTestUrls(
      ['/contactos', 'https://cliente.pt/contactos', '/contactos#form'],
      SITE,
    )
    expect(urls).toEqual(['https://cliente.pt/contactos'])
  })

  it('para no máximo e diz o que ficou de fora', () => {
    const { urls, rejected } = parseFormTestUrls(['/a', '/b', '/c', '/d'], SITE)
    expect(urls).toHaveLength(MAX_FORM_TEST_URLS)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.input).toBe('/d')
  })
})

describe('isDeclaredPage', () => {
  const declaradas = ['https://cliente.pt/contactos']

  it('reconhece a página declarada', () => {
    expect(isDeclaredPage('https://cliente.pt/contactos', declaradas, SITE)).toBe(true)
  })

  it('não se deixa enganar por uma barra final ou por uma âncora', () => {
    // Um teste que não corresse por causa de uma barra seria indistinguível
    // de um teste desligado, e ninguém ia perceber porquê.
    expect(isDeclaredPage('https://cliente.pt/contactos/', declaradas, SITE)).toBe(true)
    expect(isDeclaredPage('https://cliente.pt/contactos#form', declaradas, SITE)).toBe(true)
  })

  it('recusa outra página do mesmo site', () => {
    expect(isDeclaredPage('https://cliente.pt/sobre', declaradas, SITE)).toBe(false)
  })

  it('com a lista vazia não declara nada', () => {
    expect(isDeclaredPage('https://cliente.pt/contactos', [], SITE)).toBe(false)
  })
})
