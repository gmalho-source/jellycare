import { describe, expect, it } from 'vitest'
import { WP_INVENTORY_CHECK } from '@jellycare/connectors'
import { SECURITY_CHECK_TYPES } from '@jellycare/core'
import { lerDesempenho, lerSeguranca } from './estado-do-site'

describe('lerSeguranca', () => {
  it('fica verde sem nada em aberto', () => {
    expect(lerSeguranca([], true)).toMatchObject({ semaforo: 'verde', estado: 'Sem ameaças' })
  })

  it('fica vermelho com um problema elevado', () => {
    const leitura = lerSeguranca(
      [
        { checkType: 'tls', severity: 'high' },
        { checkType: 'security_headers', severity: 'low' },
      ],
      true,
    )
    expect(leitura).toMatchObject({ semaforo: 'vermelho', detalhe: '1 problema grave em aberto' })
  })

  it('fica laranja com um problema médio e nenhum grave', () => {
    const leitura = lerSeguranca([{ checkType: 'email_auth', severity: 'medium' }], true)
    expect(leitura.semaforo).toBe('laranja')
  })

  it('mantém o verde com recomendações menores, mas di-las', () => {
    const leitura = lerSeguranca(
      [
        { checkType: 'security_headers', severity: 'low' },
        { checkType: 'security_headers', severity: 'low' },
      ],
      true,
    )
    expect(leitura).toMatchObject({
      semaforo: 'verde',
      estado: 'Sem ameaças graves',
      detalhe: '2 recomendações menores',
    })
  })

  it('não põe o semáforo de segurança a vermelho por uma página lenta ou uma queda', () => {
    // Problemas reais, mas não de segurança. Contá-los aqui ensinava o
    // cliente a não acreditar no semáforo.
    const leitura = lerSeguranca(
      [
        { checkType: 'page_speed', severity: 'medium' },
        { checkType: 'uptime', severity: 'critical' },
        { checkType: 'broken_links', severity: 'high' },
      ],
      true,
    )
    expect(leitura.semaforo).toBe('verde')
  })

  it('a lista do core usa o mesmo nome que o conector WordPress', () => {
    // Escrito à mão no core, que não pode depender do pacote dos conectores.
    expect(SECURITY_CHECK_TYPES.has(WP_INVENTORY_CHECK)).toBe(true)
  })

  it('conta as vulnerabilidades WordPress', () => {
    const leitura = lerSeguranca([{ checkType: 'wp_inventory', severity: 'critical' }], true)
    expect(leitura.semaforo).toBe('vermelho')
  })

  it('não diz «sem ameaças» sobre um domínio que ainda não verificámos', () => {
    // Sem propriedade provada nenhuma verificação de segurança corre. Verde
    // aqui era afirmar que olhámos.
    expect(lerSeguranca([], false)).toMatchObject({ semaforo: 'cinzento', estado: 'Por verificar' })
  })
})

describe('lerDesempenho', () => {
  it('usa os limiares da Google', () => {
    expect(lerDesempenho(90).semaforo).toBe('verde')
    expect(lerDesempenho(89).semaforo).toBe('laranja')
    expect(lerDesempenho(50).semaforo).toBe('laranja')
    expect(lerDesempenho(49).semaforo).toBe('vermelho')
  })

  it('não dá juízo nenhum sem medição', () => {
    expect(lerDesempenho(null)).toMatchObject({ semaforo: 'cinzento', estado: 'Sem medição' })
  })
})
