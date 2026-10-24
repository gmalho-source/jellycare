import { describe, expect, it } from 'vitest'
import { HttpError, request } from './http.js'
import { mockFetch } from './test-utils.js'

const publico = async () => ['1.1.1.1']

describe('request com destinos públicos', () => {
  it('não pede nada a um endereço interno', async () => {
    const fetch = mockFetch({})

    await expect(
      request('http://127.0.0.1/admin', { fetchImpl: fetch, guardPublicTargets: true }),
    ).rejects.toMatchObject({ code: 'blocked_target' })

    expect(fetch.calls).toEqual([])
  })

  it('não segue um redirect para a rede interna', async () => {
    const fetch = mockFetch({
      'https://cliente.pt/': {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      },
    })

    const error = await request('https://cliente.pt/', {
      fetchImpl: fetch,
      guardPublicTargets: true,
      resolveHost: publico,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).code).toBe('blocked_target')
    expect((error as HttpError).message).not.toContain('169.254')
    expect(fetch.calls).toEqual(['https://cliente.pt/'])
  })

  it('pede a um site público', async () => {
    const fetch = mockFetch({ 'https://cliente.pt/': { status: 200, body: 'ok' } })

    const response = await request('https://cliente.pt/', {
      fetchImpl: fetch,
      guardPublicTargets: true,
      resolveHost: publico,
    })

    expect(response.status).toBe(200)
    expect(fetch.calls).toEqual(['https://cliente.pt/'])
  })
})
