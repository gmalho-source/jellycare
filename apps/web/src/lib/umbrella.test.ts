import { describe, expect, it } from 'vitest'
import { projectMatchesHostname, similarProjects } from './umbrella.js'

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

describe('similarProjects', () => {
  const projeto = (name: string, baseUrl: string) => ({
    id: 1,
    name,
    baseUrl,
    connectivity: 'paired',
    isDisconnected: false,
    isCurrentlyDown: false,
    phpIssues: 0,
  })

  it('aponta o mesmo nome noutro endereço, e não o projeto certo nem os outros', () => {
    const projetos = [
      projeto('MF Pinto', 'https://mfpinto.pt'),
      projeto('Loja', 'https://loja.mfpinto.com'),
      projeto('mfpinto.com', 'https://www.mfpinto.com'),
      projeto('Outro cliente', 'https://outro.pt'),
    ]
    expect(similarProjects(projetos, 'mfpinto.com').map((p) => p.baseUrl)).toEqual([
      'https://mfpinto.pt',
      'https://loja.mfpinto.com',
    ])
  })
})
