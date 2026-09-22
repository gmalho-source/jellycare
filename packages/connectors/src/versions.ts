/**
 * Comparação de versões do WordPress.
 *
 * Não é semver: o WordPress usa `6.5`, `6.5.1`, `6.6-RC1`, e a API devolve o
 * que o site reportar. Um `!==` entre strings dizia que `6.5` e `6.5.0` são
 * versões diferentes, e o cliente via um aviso de desatualizado sobre um site
 * que está na última versão.
 */

/** Só a parte numérica: `6.6-RC1` dá `[6, 6]`. */
function partes(versao: string): number[] {
  const numerica = versao.trim().split(/[-+]/)[0] ?? ''
  return numerica
    .split('.')
    .map((parte) => Number.parseInt(parte, 10))
    .filter((numero) => Number.isFinite(numero))
}

/** Negativo se `a` for anterior a `b`, zero se iguais, positivo se posterior. */
export function compareVersions(a: string, b: string): number {
  const esquerda = partes(a)
  const direita = partes(b)
  const comprimento = Math.max(esquerda.length, direita.length)

  for (let i = 0; i < comprimento; i++) {
    // Uma componente em falta é zero: `6.5` é a mesma coisa que `6.5.0`.
    const diferenca = (esquerda[i] ?? 0) - (direita[i] ?? 0)
    if (diferenca !== 0) return diferenca < 0 ? -1 : 1
  }

  return 0
}

/**
 * Está desatualizado?
 *
 * Só quando sabemos as duas versões e a instalada é mesmo anterior. Sem uma
 * delas devolvemos `false`, porque não saber em que versão o site está é
 * diferente de saber que está atrasado — e um aviso assente em ignorância é
 * pior do que nenhum.
 *
 * Um site à frente da última versão conhecida (uma RC, um nightly) também não
 * é desatualizado. Acontece, e dizer-lhe o contrário mina a confiança em tudo
 * o resto que o painel afirma.
 */
export function isOutdated(installed: string | null, latest: string | null): boolean {
  if (!installed || !latest) return false
  return compareVersions(installed, latest) < 0
}
