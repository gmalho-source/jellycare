import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/**
 * Destinos que um check ou um browser da plataforma pode contactar.
 *
 * O worker fala com os sites dos clientes a partir de uma rede que também
 * alcança a metadata do alojamento, o Redis e a base de dados. Sem este
 * filtro, um redirect — ou um domínio que resolve para um endereço interno —
 * transforma uma verificação de disponibilidade num pedido autenticado contra
 * a infraestrutura. A regra é a mesma em todo o lado: só HTTP(S) público.
 *
 * Em desenvolvimento e nos testes o filtro fica desligado. Os testes sobem
 * servidores em `127.0.0.1`, e ligá-lo aí partia a suite sem tornar a
 * produção mais segura. Quem chama é que decide, e em produção decide sempre
 * que sim.
 */

export type AddressResolver = (hostname: string) => Promise<string[]>

const PRIVATE_V4 = new BlockList()
for (const [rede, prefixo] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE_V4.addSubnet(rede, prefixo)
}

const PRIVATE_V6 = new BlockList()
PRIVATE_V6.addAddress('::', 'ipv6')
PRIVATE_V6.addAddress('::1', 'ipv6')
PRIVATE_V6.addSubnet('fc00::', 7, 'ipv6')
PRIVATE_V6.addSubnet('fe80::', 10, 'ipv6')
PRIVATE_V6.addSubnet('ff00::', 8, 'ipv6')
PRIVATE_V6.addSubnet('2001:db8::', 32, 'ipv6')

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog'])

/** Porque é que um destino foi recusado. `null` quando pode seguir. */
export type BlockedDestination = 'invalid' | 'protocol' | 'userinfo' | 'host' | 'address'

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
}

/**
 * Um literal numérico que não é um IP pontuado normal.
 *
 * `2130706433`, `0x7f000001` e `127.1` são todos o loopback, e o parser de
 * URL deixa-os passar como hostname. Um site real não se chama assim.
 */
function isWeirdIpLiteral(host: string): boolean {
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(host)) return true
  const parts = host.split('.')
  if (parts.length < 2 || parts.length > 4) return false
  if (!parts.every((part) => /^(?:0x[0-9a-f]+|\d+)$/i.test(part))) return false
  const octetosNormais =
    parts.length === 4 &&
    parts.every((part) => part === '0' || (/^\d+$/.test(part) && !part.startsWith('0')))
  return !octetosNormais
}

/** Nomes que nunca são um site de cliente, mesmo que o DNS os resolva. */
export function isBlockedHostname(hostname: string): boolean {
  const host = normalizedHost(hostname)
  if (!host) return true
  if (isIP(host)) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localdomain')) {
    return true
  }
  if (host.endsWith('.arpa')) return true
  if (METADATA_HOSTS.has(host)) return true
  if (!host.includes('.')) return true
  return isWeirdIpLiteral(host)
}

/** Tira o IPv4 escondido num endereço IPv6 mapeado (`::ffff:127.0.0.1`). */
function unwrapIp(ip: string): { kind: 4 | 6; address: string } | null {
  const raw = normalizedHost(ip)
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw)
  if (dotted?.[1] && isIP(dotted[1]) === 4) return { kind: 4, address: dotted[1] }

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(raw)
  if (hex?.[1] && hex[2]) {
    const hi = Number.parseInt(hex[1], 16)
    const lo = Number.parseInt(hex[2], 16)
    return { kind: 4, address: `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}` }
  }

  const kind = isIP(raw)
  if (kind === 4) return { kind: 4, address: raw }
  if (kind === 6) return { kind: 6, address: raw }
  return null
}

/** Endereços que não são de um site na internet pública. */
export function isBlockedIp(ip: string): boolean {
  const parsed = unwrapIp(ip)
  if (!parsed) return true
  if (parsed.kind === 4) return PRIVATE_V4.check(parsed.address)
  return PRIVATE_V6.check(parsed.address, 'ipv6')
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

/**
 * `null` quando o destino é um URL HTTP(S) público.
 *
 * Uma falha de DNS devolve `null`: o site está em baixo, e o pedido a seguir
 * falha da mesma maneira. Recusá-lo aqui fazia um domínio por registar
 * parecer um ataque. Se *algum* dos endereços resolvidos for interno, recusa:
 * um domínio que responde com um IP público e um privado é rebinding.
 */
export async function blockedDestinationReason(
  target: string,
  resolve: AddressResolver = defaultResolve,
): Promise<BlockedDestination | null> {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return 'invalid'
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'protocol'
  if (url.username || url.password) return 'userinfo'

  const host = normalizedHost(url.hostname)
  if (isBlockedHostname(host)) return 'host'
  if (isIP(host)) return isBlockedIp(host) ? 'address' : null

  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    return null
  }
  if (addresses.length === 0) return null
  return addresses.some((address) => isBlockedIp(address)) ? 'address' : null
}

/**
 * Um pedido feito pelo browser de testes pode seguir?
 *
 * `data:`, `blob:` e `about:` são da página, não da rede. Tudo o resto passa
 * pelo mesmo filtro dos checks.
 */
export async function browserRequestAllowed(
  target: string,
  resolve?: AddressResolver,
): Promise<boolean> {
  if (target.startsWith('data:') || target.startsWith('blob:') || target.startsWith('about:')) {
    return true
  }
  const reason = resolve
    ? await blockedDestinationReason(target, resolve)
    : await blockedDestinationReason(target)
  return reason === null
}

/** Produção é o único sítio onde o filtro está sempre ligado. */
export function guardPublicTargetsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === 'production'
}
