import { describe, expect, it } from 'vitest'
import { CODIGOS_CLAUDE_RESOLVE, REPOSITORIO_GITHUB, familiaClaudeResolve } from './claude-resolve.js'
import { EXPLICACOES } from './explicacoes.js'

describe('Claude Resolve', () => {
  it('trata cabeçalhos, email e WordPress, e mais nada', () => {
    expect(familiaClaudeResolve('missing_hsts')).toBe('cabecalhos')
    expect(familiaClaudeResolve('dmarc_policy_none')).toBe('email')
    expect(familiaClaudeResolve('wp_core_outdated')).toBe('wordpress')
    // Um site em baixo ou um ficheiro exposto não vão ao Claude sem
    // procedimento escrito para isso.
    expect(familiaClaudeResolve('site_down')).toBeNull()
    expect(familiaClaudeResolve('exposed_env')).toBeNull()
  })

  it('só aceita códigos que existem e têm explicação', () => {
    // Um código mal escrito aqui era um botão que nunca aparecia.
    for (const codigo of CODIGOS_CLAUDE_RESOLVE) expect(EXPLICACOES[codigo], codigo).toBeDefined()
  })

  it('reconhece o formato dono/nome de um repositório', () => {
    expect(REPOSITORIO_GITHUB.test('jelly-pt/site-acpa')).toBe(true)
    expect(REPOSITORIO_GITHUB.test('gmalho-source/jelly.site_2')).toBe(true)
    for (const mau of ['site-acpa', 'https://github.com/a/b', 'a/b/c', '-a/b', 'a/', '../x']) {
      expect(REPOSITORIO_GITHUB.test(mau), mau).toBe(false)
    }
  })
})
