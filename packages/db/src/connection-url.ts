/**
 * Limpeza da string de ligação.
 *
 * O `postgres.js` consome os parâmetros da query que conhece e envia todos os
 * outros ao servidor como parâmetros de arranque. Um parâmetro que só existe
 * do lado do cliente — o `channel_binding` que o Neon põe na string que a
 * consola dá a copiar, por exemplo — chega assim ao Postgres, que responde
 * `unrecognized configuration parameter` e recusa a ligação.
 *
 * Editar a string à mão resolvia uma vez e deixava a armadilha montada para
 * quem voltasse a copiar da consola. Limpar aqui resolve sempre.
 */

/**
 * Parâmetros que o libpq trata do lado do cliente e o Postgres desconhece.
 *
 * Só entram nesta lista os que o `postgres.js` não usa para nada: o `sslmode`,
 * o `sslrootcert` e o `target_session_attrs` ficam de fora de propósito,
 * porque esses ele lê.
 */
const CLIENT_ONLY_PARAMS = new Set([
  'channel_binding',
  'gssdelegation',
  'gssencmode',
  'gsslib',
  'krbsrvname',
  'passfile',
  'requirepeer',
  'service',
  'sslcert',
  'sslcompression',
  'sslcrl',
  'sslcrldir',
  'sslkey',
  'sslpassword',
  'sslsni',
])

export interface NormalizedConnectionUrl {
  url: string
  /** Os parâmetros retirados, por ordem alfabética. Vazio se não houve nenhum. */
  removed: string[]
}

export function normalizeConnectionUrl(rawUrl: string): NormalizedConnectionUrl {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    // Não é um URL que se consiga analisar. Devolve-se como está: o erro do
    // driver é mais claro do que qualquer coisa que se inventasse aqui.
    return { url: rawUrl, removed: [] }
  }

  const removed: string[] = []
  for (const key of [...parsed.searchParams.keys()]) {
    if (CLIENT_ONLY_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key)
      removed.push(key)
    }
  }

  if (removed.length === 0) return { url: rawUrl, removed: [] }

  removed.sort()
  return { url: parsed.toString(), removed }
}
