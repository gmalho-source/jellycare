/**
 * Limite de pedidos de ligação de entrada.
 *
 * O formulário é público e cada pedido de um email conhecido grava um token.
 * Sem limite, a caixa de correio de um cliente enche-se e a tabela de tokens
 * cresce à velocidade de quem estiver do outro lado. O limite é por processo:
 * chega para um dashboard com uma instância e não precisa de Redis. Quando o
 * limite dispara, a resposta é a mesma de um email desconhecido — senão o
 * limite passava a dizer quem tem conta.
 */

const WINDOW_MS = 15 * 60_000
const MAX_PER_EMAIL = 5
const MAX_PER_IP = 30

interface Bucket {
  count: number
  resetAt: number
}

const porEmail = new Map<string, Bucket>()
const porIp = new Map<string, Bucket>()

function limpar(mapa: Map<string, Bucket>, agora: number): void {
  if (mapa.size < 5_000) return
  for (const [chave, balde] of mapa) {
    if (balde.resetAt <= agora) mapa.delete(chave)
  }
}

/** `true` quando este pedido já passou do limite. */
function contar(mapa: Map<string, Bucket>, chave: string, maximo: number, agora: number): boolean {
  limpar(mapa, agora)
  const atual = mapa.get(chave)
  if (!atual || atual.resetAt <= agora) {
    mapa.set(chave, { count: 1, resetAt: agora + WINDOW_MS })
    return false
  }
  atual.count += 1
  return atual.count > maximo
}

export function loginAttemptLimited(email: string, ip: string | null, now = Date.now()): boolean {
  const emailCheio = contar(porEmail, email, MAX_PER_EMAIL, now)
  const ipCheio = ip ? contar(porIp, ip, MAX_PER_IP, now) : false
  return emailCheio || ipCheio
}

/** Os testes não podem herdar contagens uns dos outros. */
export function resetLoginRateForTests(): void {
  porEmail.clear()
  porIp.clear()
}
