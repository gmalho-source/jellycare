import { describe, expect, it } from 'vitest'
import { sectionsFor } from './site-nav.js'

const slugs = (options: { hasConnector: boolean; canManage: boolean }): string[] =>
  sectionsFor(options).map((section) => section.slug)

describe('sectionsFor', () => {
  it('só mostra o WordPress e as cópias quando há ligação', () => {
    // As duas secções são leitura do que a WP Umbrella reporta. Sem ligação
    // não há nada para ler, e um separador vazio não é um caminho: é ruído
    // em cima de todos os sites que não são WordPress.
    //
    // Ligar não se faz aqui — faz-se ao criar o site e nas definições dele,
    // que é onde se configura um site e onde se chega sem depender disto.
    expect(slugs({ hasConnector: false, canManage: true })).not.toContain('wordpress')
    expect(slugs({ hasConnector: false, canManage: true })).not.toContain('copias')

    expect(slugs({ hasConnector: true, canManage: true })).toContain('wordpress')
    expect(slugs({ hasConnector: true, canManage: true })).toContain('copias')
  })

  it('dá as secções que não dependem de nada a quem não gere', () => {
    expect(slugs({ hasConnector: false, canManage: false })).toEqual([
      '',
      'desempenho',
      'problemas',
      'seguranca',
      'formularios',
      'relatorios',
      'definicoes',
    ])
  })

  it('mostra o WordPress a um cliente de um site já ligado', () => {
    // Quem não gere não liga nem desliga, mas vê o inventário do site dele.
    expect(slugs({ hasConnector: true, canManage: false })).toContain('wordpress')
  })
})
