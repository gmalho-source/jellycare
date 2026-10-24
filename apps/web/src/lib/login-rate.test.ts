import { afterEach, describe, expect, it } from 'vitest'
import { loginAttemptLimited, resetLoginRateForTests } from './login-rate.js'

afterEach(() => {
  resetLoginRateForTests()
})

describe('loginAttemptLimited', () => {
  it('aceita cinco pedidos do mesmo email e recusa o sexto', () => {
    const agora = 1_700_000_000_000
    for (let i = 0; i < 5; i += 1) {
      expect(loginAttemptLimited('pessoa@cliente.pt', '1.2.3.4', agora)).toBe(false)
    }
    expect(loginAttemptLimited('pessoa@cliente.pt', '1.2.3.4', agora)).toBe(true)
  })

  it('um email diferente não herda o limite do anterior', () => {
    const agora = 1_700_000_000_000
    for (let i = 0; i < 5; i += 1) {
      loginAttemptLimited('pessoa@cliente.pt', null, agora)
    }

    expect(loginAttemptLimited('outra@cliente.pt', null, agora)).toBe(false)
  })

  it('o mesmo IP não pede ligações para dezenas de emails', () => {
    const agora = 1_700_000_000_000
    for (let i = 0; i < 30; i += 1) {
      expect(loginAttemptLimited(`pessoa${i}@cliente.pt`, '9.9.9.9', agora)).toBe(false)
    }
    expect(loginAttemptLimited('mais-uma@cliente.pt', '9.9.9.9', agora)).toBe(true)
  })
})
