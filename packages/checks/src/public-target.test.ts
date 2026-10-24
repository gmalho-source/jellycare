import { describe, expect, it } from 'vitest'
import {
  blockedDestinationReason,
  browserRequestAllowed,
  isBlockedHostname,
  isBlockedIp,
} from './public-target.js'

const publico = async () => ['1.1.1.1']

describe('isBlockedIp', () => {
  it('recusa redes que não são de um site público', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '255.255.255.255',
      '224.0.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('aceita um endereço público', () => {
    expect(isBlockedIp('1.1.1.1')).toBe(false)
    expect(isBlockedIp('8.8.8.8')).toBe(false)
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false)
  })
})

describe('isBlockedHostname', () => {
  it('recusa nomes que apontam para a máquina ou para a metadata', () => {
    for (const host of [
      'localhost',
      'api.localhost',
      'impressora.local',
      'db.internal',
      'metadata.google.internal',
      'intranet',
      '2130706433',
      '0x7f000001',
      '127.1',
      '0177.0.0.1',
    ]) {
      expect(isBlockedHostname(host), host).toBe(true)
    }
  })

  it('não trata um IP público nem um domínio como nome proibido', () => {
    expect(isBlockedHostname('cliente.pt')).toBe(false)
    expect(isBlockedHostname('1.1.1.1')).toBe(false)
  })
})

describe('blockedDestinationReason', () => {
  it('aceita um site público', async () => {
    expect(await blockedDestinationReason('https://cliente.pt/pagina', publico)).toBeNull()
  })

  it('recusa o que não é http, credenciais no URL e destinos internos', async () => {
    expect(await blockedDestinationReason('file:///etc/passwd', publico)).toBe('protocol')
    expect(await blockedDestinationReason('https://user:pass@cliente.pt/', publico)).toBe('userinfo')
    expect(await blockedDestinationReason('http://127.0.0.1/admin', publico)).toBe('address')
    // O parser de URL normaliza `2130706433` para `127.0.0.1` antes de o
    // vermos. Recusar pelo endereço é o que fecha o atalho.
    expect(await blockedDestinationReason('http://2130706433/', publico)).toBe('address')
    expect(await blockedDestinationReason('http://metadata.google.internal/', publico)).toBe('host')
    expect(await blockedDestinationReason('não é um url', publico)).toBe('invalid')
  })

  it('recusa quando algum dos endereços resolvidos é interno', async () => {
    const misto = async () => ['1.1.1.1', '10.0.0.8']
    expect(await blockedDestinationReason('https://cliente.pt/', misto)).toBe('address')
  })

  it('trata uma falha de DNS como site em baixo e não como ataque', async () => {
    const falha = async () => {
      throw new Error('ENOTFOUND')
    }
    expect(await blockedDestinationReason('https://cliente.pt/', falha)).toBeNull()
  })
})

describe('browserRequestAllowed', () => {
  it('deixa passar recursos da própria página e recusa a rede interna', async () => {
    expect(await browserRequestAllowed('data:image/gif;base64,AAAA', publico)).toBe(true)
    expect(await browserRequestAllowed('about:blank', publico)).toBe(true)
    expect(await browserRequestAllowed('https://cliente.pt/', publico)).toBe(true)
    expect(await browserRequestAllowed('http://127.0.0.1/', publico)).toBe(false)
  })
})
