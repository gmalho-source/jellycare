/**
 * Os problemas que o Claude Resolve aceita nesta primeira fase.
 *
 * Três famílias, escolhidas por serem frequentes, de risco baixo e por o
 * Jellycare conseguir confirmar sozinho, na verificação seguinte, que ficaram
 * resolvidas: cabeçalhos de segurança, autenticação do email (SPF e DMARC) e
 * atualizações WordPress. O resto fica de fora até haver procedimento escrito
 * no repositório-modelo — um botão que manda o Claude tratar de um site em
 * baixo ou de um ficheiro exposto sem regras para isso é pior do que não ter
 * botão.
 */
export type FamiliaClaudeResolve = 'cabecalhos' | 'email' | 'wordpress'

const FAMILIAS: Record<FamiliaClaudeResolve, readonly string[]> = {
  cabecalhos: [
    'missing_hsts',
    'missing_csp',
    'missing_frame_protection',
    'missing_content_type_options',
    'missing_referrer_policy',
    'http_not_redirected',
    'server_version_disclosed',
  ],
  email: ['spf_missing', 'spf_permissive', 'spf_duplicated', 'dmarc_missing', 'dmarc_policy_none', 'dmarc_partial'],
  wordpress: ['wp_core_outdated', 'wp_updates_pending', 'wp_known_vulnerability'],
}

const POR_CODIGO = new Map<string, FamiliaClaudeResolve>(
  (Object.entries(FAMILIAS) as [FamiliaClaudeResolve, readonly string[]][]).flatMap(([familia, codigos]) =>
    codigos.map((codigo) => [codigo, familia] as const),
  ),
)

/** A família do problema, ou `null` se o Claude Resolve ainda não o trata. */
export function familiaClaudeResolve(code: string): FamiliaClaudeResolve | null {
  return POR_CODIGO.get(code) ?? null
}

export const CODIGOS_CLAUDE_RESOLVE: readonly string[] = [...POR_CODIGO.keys()]

/** `dono/nome` de um repositório do GitHub, como a API o espera. */
export const REPOSITORIO_GITHUB = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/
