/**
 * Registo com estrangulamento para erros que se repetem.
 *
 * O Redis do Upstash esgotou a quota e passou a recusar todos os comandos. A
 * mesma mensagem — a mesma linha, palavra por palavra — foi escrita catorze
 * mil vezes por minuto durante dezoito horas. São cerca de catorze milhões de
 * linhas, com custo de ingestão, e nenhuma delas dizia mais do que a
 * primeira.
 *
 * A primeira ocorrência sai na hora, porque é ela que interessa. As iguais
 * que venham a seguir são contadas em silêncio, e a contagem sai com a
 * próxima que passe a janela. Assim não se perde nada — nem o alerta nem o
 * volume — e escreve-se uma linha por minuto em vez de catorze mil.
 */

export interface ThrottleOptions {
  /** Silêncio entre duas linhas da mesma mensagem. */
  windowMs?: number
  now?: () => Date
  /** Para onde vai a linha. Injetável para o teste a poder ler. */
  sink?: (line: string, detail?: unknown) => void
}

export interface ThrottledLogger {
  /**
   * Regista um erro.
   *
   * `key` é o que define «a mesma mensagem». Deve ser a mensagem em si e não
   * a pilha: duas ocorrências do mesmo erro têm pilhas idênticas mas
   * carimbos diferentes, e comparar pilhas fazia o estrangulador nunca
   * agrupar nada.
   */
  error(key: string, detail?: unknown): void
  /** Ocorrências suprimidas de uma chave, para teste e para o encerramento. */
  suppressed(key: string): number
}

const DEFAULT_WINDOW_MS = 60_000

interface Entrada {
  ultimaSaida: number
  suprimidas: number
}

export function createThrottledLogger(options: ThrottleOptions = {}): ThrottledLogger {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const now = options.now ?? (() => new Date())
  const sink = options.sink ?? ((line, detail) => console.error(line, detail ?? ''))

  const entradas = new Map<string, Entrada>()

  return {
    error(key, detail) {
      const instante = now().getTime()
      const entrada = entradas.get(key)

      if (!entrada) {
        entradas.set(key, { ultimaSaida: instante, suprimidas: 0 })
        sink(key, detail)
        return
      }

      if (instante - entrada.ultimaSaida < windowMs) {
        entrada.suprimidas++
        return
      }

      const suprimidas = entrada.suprimidas
      entrada.ultimaSaida = instante
      entrada.suprimidas = 0

      // O número entra na linha. Sem ele, quem lê os registos vê um erro por
      // minuto e não faz ideia de que são catorze mil — e a diferença entre
      // «um soluço» e «tudo partido» está precisamente nesse número.
      sink(
        suprimidas > 0
          ? `${key} (mais ${suprimidas} iguais nos últimos ${Math.round(windowMs / 1000)}s)`
          : key,
        detail,
      )
    },

    suppressed(key) {
      return entradas.get(key)?.suprimidas ?? 0
    },
  }
}

/** A mensagem de um erro, que é o que agrupa ocorrências iguais. */
export function errorKey(prefix: string, error: unknown): string {
  const mensagem = error instanceof Error ? error.message : String(error)
  return `${prefix}: ${mensagem}`
}
