import { describe, expect, it } from 'vitest'
import { mockFetch, type MockRoutes } from './test-utils.js'
import {
  buildChallenge,
  buildChallenges,
  generateVerificationToken,
  verificationFilePath,
  verifyOwnership,
  verifyOwnershipAny,
} from './verification.js'

const TOKEN = 'jellycare-site-verification=0123456789abcdef0123456789abcdef'

describe('generateVerificationToken', () => {
  it('gera tokens com prefixo reconhecível e distintos entre si', () => {
    const a = generateVerificationToken()
    const b = generateVerificationToken()

    expect(a.startsWith('jellycare-site-verification=')).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('verificationFilePath', () => {
  it('deriva o caminho do token, para não ser adivinhável', () => {
    const path = verificationFilePath(TOKEN)

    expect(path).toMatch(/^\/\.well-known\/jellycare-[0-9a-f]{32}\.txt$/)
    expect(verificationFilePath('outro-token')).not.toBe(path)
  })

  it('é estável para o mesmo token', () => {
    expect(verificationFilePath(TOKEN)).toBe(verificationFilePath(TOKEN))
  })
})

describe('buildChallenge', () => {
  it('usa o domínio registável no registo TXT, não o subdomínio', () => {
    const challenge = buildChallenge('dns_txt', 'www.cliente.pt', TOKEN)

    expect(challenge.location).toBe('_jellycare.cliente.pt')
    expect(challenge.instructions).toContain(TOKEN)
  })

  it('dá instruções com o URL completo no método de ficheiro', () => {
    const challenge = buildChallenge('http_file', 'cliente.pt', TOKEN)

    expect(challenge.location).toBe(verificationFilePath(TOKEN))
    expect(challenge.instructions).toContain('https://cliente.pt/.well-known/')
  })
})

describe('verifyOwnership — DNS', () => {
  const base = { method: 'dns_txt' as const, hostname: 'cliente.pt', siteUrl: 'https://cliente.pt', token: TOKEN }

  it('confirma quando o TXT corresponde', async () => {
    const result = await verifyOwnership(base, { resolveTxt: async () => [[TOKEN]] })
    expect(result.verified).toBe(true)
  })

  it('junta os blocos de 255 caracteres antes de comparar', async () => {
    const half = Math.floor(TOKEN.length / 2)
    const result = await verifyOwnership(base, {
      resolveTxt: async () => [[TOKEN.slice(0, half), TOKEN.slice(half)]],
    })

    expect(result.verified).toBe(true)
  })

  it('não confirma com um token diferente', async () => {
    const result = await verifyOwnership(base, {
      resolveTxt: async () => [['jellycare-site-verification=outro']],
    })

    expect(result.verified).toBe(false)
    expect(result.observed).toHaveLength(1)
  })

  it('ignora outros registos TXT do domínio', async () => {
    const result = await verifyOwnership(base, {
      resolveTxt: async () => [['v=spf1 -all'], ['google-site-verification=xyz'], [TOKEN]],
    })

    expect(result.verified).toBe(true)
  })

  it('explica em linguagem útil quando o registo não existe', async () => {
    const result = await verifyOwnership(base, {
      resolveTxt: async () => {
        throw new Error('ENOTFOUND')
      },
    })

    expect(result.verified).toBe(false)
    expect(result.detail).toContain('pode ainda não ter propagado')
  })
})

describe('verifyOwnership — ficheiro', () => {
  const base = {
    method: 'http_file' as const,
    hostname: 'cliente.pt',
    siteUrl: 'https://cliente.pt',
    token: TOKEN,
  }

  function routes(overrides: MockRoutes = {}): MockRoutes {
    return {
      [`https://cliente.pt${verificationFilePath(TOKEN)}`]: { body: TOKEN },
      ...overrides,
    }
  }

  it('confirma quando o ficheiro tem o token', async () => {
    const result = await verifyOwnership(base, { fetchImpl: mockFetch(routes()) })
    expect(result.verified).toBe(true)
  })

  it('tolera espaços e quebras de linha à volta do valor', async () => {
    const result = await verifyOwnership(base, {
      fetchImpl: mockFetch(
        routes({ [`https://cliente.pt${verificationFilePath(TOKEN)}`]: { body: `\n  ${TOKEN}  \n` } }),
      ),
    })

    expect(result.verified).toBe(true)
  })

  it('não confirma quando o servidor devolve a homepage em vez do ficheiro', async () => {
    // Soft-404: um site que responde 200 a tudo não pode passar a verificação.
    const result = await verifyOwnership(base, {
      fetchImpl: mockFetch({}, { status: 200, body: '<html><body>Página não encontrada</body></html>' }),
    })

    expect(result.verified).toBe(false)
    expect(result.detail).toContain('não corresponde ao token')
  })

  it('explica quando o ficheiro não existe', async () => {
    const result = await verifyOwnership(base, { fetchImpl: mockFetch({}) })

    expect(result.verified).toBe(false)
    expect(result.detail).toContain('404')
  })

  it('não rebenta quando o site está inacessível', async () => {
    const result = await verifyOwnership(base, {
      fetchImpl: mockFetch({
        [`https://cliente.pt${verificationFilePath(TOKEN)}`]: { error: new Error('ECONNREFUSED') },
      }),
    })

    expect(result.verified).toBe(false)
    expect(result.detail).toContain('Não foi possível obter')
  })
})

describe('verifyOwnershipAny', () => {
  const TOKEN = 'jellycare-site-verification=abc123'
  const ENTRADA = { hostname: 'cliente.pt', siteUrl: 'https://cliente.pt', token: TOKEN }

  const semDns = async () => {
    throw new Error('ENOTFOUND')
  }
  const semFicheiro = (async () =>
    new Response('não encontrado', { status: 404 })) as typeof globalThis.fetch

  const comFicheiro = (async () =>
    new Response(TOKEN, { status: 200 })) as typeof globalThis.fetch

  it('aceita a prova por DNS e nem chega a pedir o ficheiro', async () => {
    // O DNS vai primeiro porque não depende de o site estar a responder.
    let pediu = false
    const resultado = await verifyOwnershipAny(ENTRADA, {
      resolveTxt: async () => [[TOKEN]],
      fetchImpl: (async () => {
        pediu = true
        return new Response('', { status: 200 })
      }) as typeof globalThis.fetch,
    })

    expect(resultado.verified).toBe(true)
    expect(resultado.method).toBe('dns_txt')
    expect(pediu).toBe(false)
  })

  it('aceita a prova por ficheiro quando o DNS não tem nada', async () => {
    // É este o caso que motivou tudo: quem não controla o DNS do cliente só
    // descobre que o TXT não é viável depois de tentar.
    const resultado = await verifyOwnershipAny(ENTRADA, {
      resolveTxt: semDns,
      fetchImpl: comFicheiro,
    })

    expect(resultado.verified).toBe(true)
    expect(resultado.method).toBe('http_file')
  })

  it('explica as duas falhas, e não só a última', async () => {
    // Quem lê isto precisa de saber o que correu mal em cada via para
    // escolher qual seguir.
    const resultado = await verifyOwnershipAny(ENTRADA, {
      resolveTxt: semDns,
      fetchImpl: semFicheiro,
    })

    expect(resultado.verified).toBe(false)
    expect(resultado.detail).toContain('Registo TXT')
    expect(resultado.detail).toContain('Ficheiro')
  })

  it('recusa um ficheiro com o token errado', async () => {
    const resultado = await verifyOwnershipAny(ENTRADA, {
      resolveTxt: semDns,
      fetchImpl: (async () =>
        new Response('jellycare-site-verification=outro', {
          status: 200,
        })) as typeof globalThis.fetch,
    })

    expect(resultado.verified).toBe(false)
  })
})

describe('buildChallenges', () => {
  it('dá as duas instruções para o mesmo token', () => {
    // O token é o mesmo nas duas vias: muda só onde é publicado. Se
    // divergissem, provar por uma não provaria nada sobre a outra.
    const token = 'jellycare-site-verification=xyz'
    const { dns, file } = buildChallenges('cliente.pt', token)

    expect(dns.token).toBe(token)
    expect(file.token).toBe(token)
    expect(dns.location).toContain('_jellycare.')
    expect(file.location).toContain('/.well-known/')
  })
})
