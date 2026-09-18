import type { AuthenticatedUser } from '@jellycare/db'
import { describe, expect, it } from 'vitest'
import { canGrantRole, canManage, isClientOnly, roleIn } from './session.js'

const ORG = '11111111-1111-1111-1111-111111111111'
const OUTRA = '22222222-2222-2222-2222-222222222222'

function utilizador(...memberships: { organizationId: string; role: string }[]): AuthenticatedUser {
  return { id: 'u1', email: 'p@exemplo.pt', name: null, memberships }
}

describe('isClientOnly', () => {
  it('é cliente quando todas as pertenças são de cliente', () => {
    expect(isClientOnly(utilizador({ organizationId: ORG, role: 'client' }))).toBe(true)
  })

  it('não é cliente quem é equipa nalguma organização', () => {
    // Quem é da Jelly e cliente de si próprio continua a ser equipa: mandá-lo
    // para o portal tirava-lhe o painel de que precisa para trabalhar.
    const misto = utilizador(
      { organizationId: ORG, role: 'client' },
      { organizationId: OUTRA, role: 'member' },
    )

    expect(isClientOnly(misto)).toBe(false)
  })

  it('não trata como cliente quem não pertence a nada', () => {
    expect(isClientOnly(utilizador())).toBe(false)
  })
})

describe('canManage', () => {
  it('a equipa gere, o cliente não', () => {
    expect(canManage(utilizador({ organizationId: ORG, role: 'member' }), ORG)).toBe(true)
    expect(canManage(utilizador({ organizationId: ORG, role: 'client' }), ORG)).toBe(false)
  })

  it('não gere uma organização a que não pertence', () => {
    expect(canManage(utilizador({ organizationId: ORG, role: 'owner' }), OUTRA)).toBe(false)
  })
})

describe('canGrantRole', () => {
  it('um membro de equipa não cria administradores', () => {
    // Sem esta regra, um membro concedia o papel de administrador a um
    // endereço seu e promovia-se pela porta do lado.
    const membro = utilizador({ organizationId: ORG, role: 'member' })

    expect(canGrantRole(membro, ORG, 'admin')).toBe(false)
    expect(canGrantRole(membro, ORG, 'member')).toBe(true)
    expect(canGrantRole(membro, ORG, 'client')).toBe(true)
  })

  it('um administrador cria administradores mas não donos', () => {
    const admin = utilizador({ organizationId: ORG, role: 'admin' })

    expect(canGrantRole(admin, ORG, 'admin')).toBe(true)
    expect(canGrantRole(admin, ORG, 'owner')).toBe(false)
  })

  it('um cliente não concede nada', () => {
    const cliente = utilizador({ organizationId: ORG, role: 'client' })

    expect(canGrantRole(cliente, ORG, 'client')).toBe(false)
  })

  it('ninguém concede numa organização a que não pertence', () => {
    const dono = utilizador({ organizationId: ORG, role: 'owner' })

    expect(canGrantRole(dono, OUTRA, 'client')).toBe(false)
  })
})

describe('roleIn', () => {
  it('devolve o papel na organização pedida', () => {
    const misto = utilizador(
      { organizationId: ORG, role: 'client' },
      { organizationId: OUTRA, role: 'owner' },
    )

    expect(roleIn(misto, ORG)).toBe('client')
    expect(roleIn(misto, OUTRA)).toBe('owner')
    expect(roleIn(misto, 'outra-qualquer')).toBeNull()
  })
})
