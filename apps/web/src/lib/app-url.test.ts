import { afterEach, describe, expect, it } from 'vitest'
import { appOrigin, appUrl } from './app-url.js'

const original = process.env.JELLYCARE_APP_URL

afterEach(() => {
  if (original === undefined) delete process.env.JELLYCARE_APP_URL
  else process.env.JELLYCARE_APP_URL = original
})

describe('appOrigin', () => {
  it('usa o domínio configurado e ignora o host do pedido', () => {
    // O caso que partiu em produção ao contrário: atrás do proxy do Fly, o
    // host visto pelo servidor é o endereço de escuta, não o domínio público.
    process.env.JELLYCARE_APP_URL = 'https://jellycare.pt'

    expect(appOrigin(new Headers({ host: '0.0.0.0:3000' }))).toBe('https://jellycare.pt')
  })

  it('não deixa um host forjado desviar a ligação de entrada', () => {
    // Se o host do pedido ganhasse, bastava forjá-lo para a ligação de entrada
    // enviada por email apontar para o domínio de quem o forjou.
    process.env.JELLYCARE_APP_URL = 'https://jellycare.pt'

    expect(appOrigin(new Headers({ host: 'atacante.example' }))).toBe('https://jellycare.pt')
  })

  it('tira a barra final do domínio configurado', () => {
    process.env.JELLYCARE_APP_URL = 'https://jellycare.pt/'

    expect(appUrl('/login').toString()).toBe('https://jellycare.pt/login')
  })

  it('cai no host do pedido quando não há domínio configurado', () => {
    delete process.env.JELLYCARE_APP_URL

    expect(appOrigin(new Headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
    expect(appOrigin(new Headers({ host: 'exemplo.pt' }))).toBe('https://exemplo.pt')
  })

  it('constrói o caminho de erro completo', () => {
    process.env.JELLYCARE_APP_URL = 'https://jellycare.pt'

    expect(appUrl('/login?erro=ligacao', new Headers({ host: '0.0.0.0:3000' })).toString()).toBe(
      'https://jellycare.pt/login?erro=ligacao',
    )
  })
})
