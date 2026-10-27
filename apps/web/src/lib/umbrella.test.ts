import { describe, expect, it } from 'vitest'
import { projectMatchesHostname } from './umbrella.js'

describe('projectMatchesHostname', () => {
  it('aceita o mesmo hostname, com ou sem www', () => {
    expect(projectMatchesHostname('https://cliente.pt', 'cliente.pt')).toBe(true)
    expect(projectMatchesHostname('https://www.cliente.pt/', 'cliente.pt')).toBe(true)
    expect(projectMatchesHostname('cliente.pt', 'www.cliente.pt')).toBe(true)
  })

  it('recusa um subdomínio e outro domínio', () => {
    expect(projectMatchesHostname('https://blog.cliente.pt', 'cliente.pt')).toBe(false)
    expect(projectMatchesHostname('https://outro.pt', 'cliente.pt')).toBe(false)
  })

  it('recusa um endereço que não se consegue ler', () => {
    expect(projectMatchesHostname('não é um url com espaços', 'cliente.pt')).toBe(false)
  })
})
