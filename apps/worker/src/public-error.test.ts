import { describe, expect, it } from 'vitest'
import { publicErrorText } from './scheduler.js'

describe('publicErrorText', () => {
  it('tira endereços e identificadores de site', () => {
    const texto = publicErrorText(
      'uptime/11111111-1111-4111-8111-111111111111: falha em https://cliente.pt/wp-admin?x=1',
    )

    expect(texto).not.toContain('11111111')
    expect(texto).not.toContain('cliente.pt')
    expect(texto).toContain('[id]')
    expect(texto).toContain('[url]')
    expect(texto).toContain('falha em')
  })

  it('mantém o erro da fila, que é o que a equipa precisa de ler', () => {
    expect(publicErrorText('ERR max requests limit exceeded')).toContain('max requests limit exceeded')
  })
})
