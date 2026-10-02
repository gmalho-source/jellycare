import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { grantAccess, createLoginToken, consumeLoginToken } from './auth-repo.js'
import { createDatabase } from './client.js'
import {
  EquipaSemNinguemError,
  acrescentarAEquipa,
  acrescentarContacto,
  alterarContacto,
  apagarContacto,
  criarOrganizacao,
  definirAcessoDoContacto,
  destinatariosDoRelatorio,
  listarContactos,
  listarEquipa,
  moverSite,
  retirarDaEquipa,
  slugDe,
} from './organizations.js'
import { organizationContacts, organizations, sites, users } from './schema.js'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:55432/jellycare_test'

const { db, close } = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

const marca = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const criadas: string[] = []
const emails: string[] = []

async function organizacao(nome = `Cliente ${marca()}`) {
  const org = await criarOrganizacao(db, nome)
  criadas.push(org.id)
  return org
}

async function site(organizationId: string, reportRecipients: string[] = []) {
  const [linha] = await db
    .insert(sites)
    .values({ organizationId, label: 'Site', url: 'https://cliente.pt', hostname: 'cliente.pt', state: 'active', reportRecipients })
    .returning({ id: sites.id })
  return linha!.id
}

/** Entra como a pessoa, pelo caminho a sério, e devolve o utilizador da sessão. */
async function entrar(email: string) {
  const criado = await createLoginToken(db, email)
  const sessao = await consumeLoginToken(db, criado!.token)
  return sessao!.user
}

// A equipa é global à base de dados: os testes só mexem em quem criam, e
// arrumam a seguir, para não tirarem da equipa alguém de outro teste.
beforeEach(async () => {
  if (emails.length > 0) await db.update(users).set({ isStaff: false }).where(inArray(users.email, emails))
})

afterAll(async () => {
  if (criadas.length > 0) await db.delete(organizations).where(inArray(organizations.id, criadas))
  if (emails.length > 0) await db.delete(users).where(inArray(users.email, emails))
  await close()
})

const novoEmail = () => {
  const email = `equipa-${marca()}@jelly.pt`
  emails.push(email)
  return email
}

describe('Equipa Jelly', () => {
  it('quem está na equipa é administrador em todas as organizações, incluindo as criadas depois', async () => {
    const email = novoEmail()
    const antes = await organizacao()
    await acrescentarAEquipa(db, email)

    const depois = await organizacao()
    const user = await entrar(email)

    expect(user.isStaff).toBe(true)
    const papeis = new Map(user.memberships.map((m) => [m.organizationId, m.role]))
    expect(papeis.get(antes.id)).toBe('admin')
    expect(papeis.get(depois.id)).toBe('admin')
  })

  it('um papel de dono que a pessoa já tinha mantém-se', async () => {
    const email = novoEmail()
    const org = await organizacao()
    const { userId } = await acrescentarAEquipa(db, email)
    const { memberships } = await import('./schema.js')
    await db.insert(memberships).values({ organizationId: org.id, userId, role: 'owner' })

    const user = await entrar(email)
    expect(user.memberships.find((m) => m.organizationId === org.id)?.role).toBe('owner')
  })

  it('sair da equipa tira o acesso geral, e deixa o que a pessoa tinha por si', async () => {
    const email = novoEmail()
    const outro = novoEmail()
    await acrescentarAEquipa(db, outro)
    const daPessoa = await organizacao()
    const deOutros = await organizacao()
    const { userId } = await acrescentarAEquipa(db, email)
    await grantAccess(db, { organizationId: daPessoa.id, email, role: 'member' })

    await retirarDaEquipa(db, userId)
    const user = await entrar(email)

    expect(user.isStaff).toBe(false)
    expect(user.memberships.map((m) => m.organizationId)).toContain(daPessoa.id)
    expect(user.memberships.map((m) => m.organizationId)).not.toContain(deOutros.id)
  })

  it('acrescentar duas vezes não duplica, e diz que a segunda não era nova', async () => {
    const email = novoEmail()
    expect((await acrescentarAEquipa(db, email)).entrou).toBe(true)
    expect((await acrescentarAEquipa(db, email.toUpperCase())).entrou).toBe(false)
    expect((await listarEquipa(db)).filter((m) => m.email === email)).toHaveLength(1)
  })

  it('não deixa a equipa ficar vazia', async () => {
    // Tira toda a gente menos uma pessoa, e tenta tirar essa.
    const email = novoEmail()
    const { userId } = await acrescentarAEquipa(db, email)
    const antes = await db.select({ id: users.id }).from(users).where(eq(users.isStaff, true))
    const outros = antes.filter((u) => u.id !== userId).map((u) => u.id)
    if (outros.length > 0) await db.update(users).set({ isStaff: false }).where(inArray(users.id, outros))
    try {
      await expect(retirarDaEquipa(db, userId)).rejects.toBeInstanceOf(EquipaSemNinguemError)
    } finally {
      if (outros.length > 0) await db.update(users).set({ isStaff: true }).where(inArray(users.id, outros))
    }
  })
})

describe('organizações', () => {
  it('dá um identificador legível, sem acentos, e único mesmo com nomes iguais', async () => {
    expect(slugDe('  Clínica Sorriso — Lisboa! ')).toBe('clinica-sorriso-lisboa')
    const nome = `Ótica ${marca()}`
    const a = await organizacao(nome)
    const b = await organizacao(nome)
    expect(a.slug).not.toBe(b.slug)
    expect(b.slug.startsWith(a.slug)).toBe(true)
  })

  it('muda um site de organização', async () => {
    const origem = await organizacao()
    const destino = await organizacao()
    const siteId = await site(origem.id)
    await moverSite(db, siteId, destino.id)
    const [linha] = await db.select({ org: sites.organizationId }).from(sites).where(eq(sites.id, siteId))
    expect(linha?.org).toBe(destino.id)
  })
})

describe('contactos', () => {
  it('guarda nome, função, telefone e email, e limpa os vazios', async () => {
    const org = await organizacao()
    await acrescentarContacto(db, org.id, {
      name: '  Ana Silva ',
      jobTitle: 'Diretora de marketing',
      phone: '+351 912 345 678',
      email: 'Ana@Cliente.PT',
      receivesReports: true,
    })
    await acrescentarContacto(db, org.id, { name: 'Rui', jobTitle: '  ', phone: '', email: null, receivesReports: false })

    expect(await listarContactos(db, org.id)).toMatchObject([
      { name: 'Ana Silva', jobTitle: 'Diretora de marketing', phone: '+351 912 345 678', email: 'ana@cliente.pt', receivesReports: true },
      { name: 'Rui', jobTitle: null, phone: null, email: null, receivesReports: false },
    ])
  })

  it('recusa um contacto marcado para relatórios sem email', async () => {
    const org = await organizacao()
    await expect(
      acrescentarContacto(db, org.id, { name: 'Sem email', receivesReports: true }),
    ).rejects.toThrow()
  })

  it('só altera ou apaga contactos da organização indicada', async () => {
    const org = await organizacao()
    const outra = await organizacao()
    const id = await acrescentarContacto(db, org.id, { name: 'Ana', receivesReports: false })

    await alterarContacto(db, outra.id, id, { name: 'Mudado por outra', receivesReports: false })
    await apagarContacto(db, outra.id, id)
    expect((await listarContactos(db, org.id)).map((c) => c.name)).toEqual(['Ana'])

    await alterarContacto(db, org.id, id, { name: 'Ana Costa', jobTitle: 'TI', receivesReports: false })
    expect((await listarContactos(db, org.id))[0]).toMatchObject({ name: 'Ana Costa', jobTitle: 'TI' })
    await apagarContacto(db, org.id, id)
    expect(await listarContactos(db, org.id)).toEqual([])
  })

  it('o relatório vai para os destinatários do site e para os contactos marcados, sem repetidos', async () => {
    const org = await organizacao()
    const siteId = await site(org.id, ['geral@cliente.pt', 'Ana@cliente.pt'])
    await acrescentarContacto(db, org.id, { name: 'Ana', email: 'ana@cliente.pt', receivesReports: true })
    await acrescentarContacto(db, org.id, { name: 'Rui', email: 'rui@cliente.pt', receivesReports: true })
    await acrescentarContacto(db, org.id, { name: 'Contabilidade', email: 'contas@cliente.pt', receivesReports: false })

    expect(await destinatariosDoRelatorio(db, siteId)).toEqual(['geral@cliente.pt', 'Ana@cliente.pt', 'rui@cliente.pt'])
  })

  it('os contactos de outra organização não recebem o relatório deste site', async () => {
    const org = await organizacao()
    const outra = await organizacao()
    const siteId = await site(org.id)
    await acrescentarContacto(db, outra.id, { name: 'Alheio', email: 'alheio@outro.pt', receivesReports: true })
    expect(await destinatariosDoRelatorio(db, siteId)).toEqual([])
    expect(await db.select().from(organizationContacts).where(eq(organizationContacts.organizationId, org.id))).toEqual([])
  })
})

describe('acesso ao portal a partir do contacto', () => {
  it('dá acesso de cliente, e a ficha passa a mostrá-lo', async () => {
    const org = await organizacao()
    const email = novoEmail()
    await acrescentarContacto(db, org.id, { name: 'Ana', email, receivesReports: false })

    expect(await definirAcessoDoContacto(db, org.id, email, true)).toBe('concedido')
    expect(await definirAcessoDoContacto(db, org.id, email, true)).toBe('sem_mudanca')
    expect((await listarContactos(db, org.id))[0]?.acesso).toBe('cliente')

    const user = await entrar(email)
    expect(user.memberships).toEqual([{ organizationId: org.id, role: 'client' }])
  })

  it('nunca despromove a cliente quem já é da equipa nessa organização', async () => {
    const org = await organizacao()
    const email = novoEmail()
    await grantAccess(db, { organizationId: org.id, email, role: 'member' })
    await acrescentarContacto(db, org.id, { name: 'Da equipa', email, receivesReports: false })

    expect(await definirAcessoDoContacto(db, org.id, email, true)).toBe('sem_mudanca')
    expect((await listarContactos(db, org.id))[0]?.acesso).toBe('equipa')
    // E desmarcar também não lhe tira o acesso de equipa.
    expect(await definirAcessoDoContacto(db, org.id, email, false)).toBe('sem_mudanca')
    expect((await entrar(email)).memberships).toEqual([{ organizationId: org.id, role: 'member' }])
  })

  it('tira o acesso de cliente, e só nesta organização', async () => {
    const org = await organizacao()
    const outra = await organizacao()
    const email = novoEmail()
    await definirAcessoDoContacto(db, org.id, email, true)
    await definirAcessoDoContacto(db, outra.id, email, true)

    expect(await definirAcessoDoContacto(db, org.id, email, false)).toBe('retirado')
    expect((await entrar(email)).memberships).toEqual([{ organizationId: outra.id, role: 'client' }])
  })
})
