import type { Severity } from '@jellycare/core'

/**
 * CVSS para a nossa escala.
 *
 * As faixas são as do CVSS v3, tal como o FIRST as define, e não uma invenção
 * nossa: 9.0+ crítico, 7.0–8.9 elevado, 4.0–6.9 médio, 0.1–3.9 baixo. Usar as
 * faixas oficiais importa porque o cliente pode ir ver o mesmo CVE no
 * Patchstack ou no NVD, e uma severidade que discordasse da fonte punha em
 * causa tudo o resto que dizemos.
 */
export function severityFromCvss(score: number | null): Severity {
  if (score === null || !Number.isFinite(score)) {
    // Uma vulnerabilidade sem score continua a ser uma vulnerabilidade. Média
    // é o que a faz aparecer no resumo diário sem interromper ninguém de
    // madrugada por uma coisa que não sabemos quantificar.
    return 'medium'
  }

  if (score >= 9) return 'critical'
  if (score >= 7) return 'high'
  if (score >= 4) return 'medium'
  if (score > 0) return 'low'
  return 'info'
}
