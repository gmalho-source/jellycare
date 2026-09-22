import { describe, expect, it } from 'vitest'
import { createThrottledLogger, errorKey } from './log-throttle.js'

function harness(windowMs = 60_000) {
  const linhas: string[] = []
  let relogio = new Date('2026-09-22T00:00:00Z')
  const logger = createThrottledLogger({
    windowMs,
    now: () => relogio,
    sink: (line) => linhas.push(line),
  })
  return {
    logger,
    linhas,
    avanca: (ms: number) => {
      relogio = new Date(relogio.getTime() + ms)
    },
  }
}

describe('createThrottledLogger', () => {
  it('escreve a primeira ocorrência de imediato', () => {
    const { logger, linhas } = harness()
    logger.error('Redis recusou')

    // A primeira é a que interessa. Atrasá-la para agrupar seria esconder o
    // início da avaria, que é exatamente o instante que se quer saber.
    expect(linhas).toEqual(['Redis recusou'])
  })

  it('cala as iguais dentro da janela', () => {
    const { logger, linhas, avanca } = harness(60_000)
    logger.error('Redis recusou')
    for (let i = 0; i < 14_000; i++) {
      avanca(1)
      logger.error('Redis recusou')
    }

    expect(linhas).toHaveLength(1)
    expect(logger.suppressed('Redis recusou')).toBe(14_000)
  })

  it('a linha seguinte traz a contagem do que foi calado', () => {
    const { logger, linhas, avanca } = harness(60_000)
    logger.error('Redis recusou')
    for (let i = 0; i < 5; i++) logger.error('Redis recusou')

    avanca(60_001)
    logger.error('Redis recusou')

    // Sem o número, quem lê vê um erro por minuto e não sabe se é um soluço
    // ou se está tudo partido.
    expect(linhas[1]).toBe('Redis recusou (mais 5 iguais nos últimos 60s)')
  })

  it('não inventa contagem quando não houve supressão', () => {
    const { logger, linhas, avanca } = harness(60_000)
    logger.error('Redis recusou')
    avanca(60_001)
    logger.error('Redis recusou')

    expect(linhas[1]).toBe('Redis recusou')
  })

  it('erros diferentes não se calam uns aos outros', () => {
    const { logger, linhas } = harness()
    logger.error('Redis recusou')
    logger.error('Postgres recusou')

    // Agrupar por chave e não globalmente: um erro novo durante uma avaria
    // em curso é informação nova, e é a que mais custa perder.
    expect(linhas).toEqual(['Redis recusou', 'Postgres recusou'])
  })

  it('a contagem reinicia depois de sair', () => {
    const { logger, avanca } = harness(60_000)
    logger.error('x')
    logger.error('x')
    avanca(60_001)
    logger.error('x')

    expect(logger.suppressed('x')).toBe(0)
  })
})

describe('errorKey', () => {
  it('agrupa pela mensagem e não pela pilha', () => {
    // Duas ocorrências do mesmo erro têm pilhas iguais mas objetos
    // diferentes; comparar o objeto fazia o estrangulador nunca agrupar.
    const a = errorKey('Fila', new Error('ERR max requests limit exceeded'))
    const b = errorKey('Fila', new Error('ERR max requests limit exceeded'))

    expect(a).toBe(b)
    expect(a).toContain('max requests limit exceeded')
  })

  it('lida com o que não é um Error', () => {
    expect(errorKey('Fila', 'texto solto')).toBe('Fila: texto solto')
  })
})
