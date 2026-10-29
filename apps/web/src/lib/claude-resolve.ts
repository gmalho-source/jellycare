import { explicacaoDe, familiaClaudeResolve, type FamiliaClaudeResolve } from '@jellycare/core'

/**
 * O Claude Resolve, do lado do Jellycare: a issue que leva um problema ao
 * repositório do site.
 *
 * O Jellycare só escreve a issue. Quem trabalha é o GitHub Action do Claude
 * Code no repositório do site, que arranca com a etiqueta `claude-resolve` e
 * segue o `CLAUDE.md` do repositório-modelo: prepara a correção num pull
 * request, com o plano de aplicação e de reversão, e não aplica nada em
 * produção. Ver docs/claude-resolve.md.
 */

export const ETIQUETA_CLAUDE_RESOLVE = 'claude-resolve'

/** Marca escondida na issue, para se saber de que problema veio. */
export const marcaDoProblema = (findingId: string) => `<!-- jellycare:finding=${findingId} -->`

const NOME_DA_FAMILIA: Record<FamiliaClaudeResolve, string> = {
  cabecalhos: 'Cabeçalhos de segurança',
  email: 'Autenticação do email (SPF e DMARC)',
  wordpress: 'Atualizações WordPress',
}

const PROCEDIMENTO: Record<FamiliaClaudeResolve, string> = {
  cabecalhos: 'docs/procedimentos/cabecalhos.md',
  email: 'docs/procedimentos/email.md',
  wordpress: 'docs/procedimentos/wordpress.md',
}

export interface ProblemaParaIssue {
  id: string
  code: string
  severity: string
  title: string
  detail: string | null
  discriminator: string | null
  evidence: unknown
  firstSeenAt: Date
}

export interface SiteParaIssue {
  label: string
  url: string
  hostname: string
  platform: string | null
}

export interface IssueMontada {
  title: string
  body: string
  labels: string[]
}

/** A evidência em JSON, curta: é contexto para o Claude, não um anexo. */
function evidenciaEmTexto(evidencia: unknown): string | null {
  if (evidencia === null || evidencia === undefined) return null
  if (typeof evidencia === 'object' && Object.keys(evidencia as object).length === 0) return null
  const texto = JSON.stringify(evidencia, null, 2)
  return texto.length > 2000 ? `${texto.slice(0, 2000)}\n…` : texto
}

/**
 * Monta a issue a partir do problema.
 *
 * Leva tudo o que o Claude precisa para trabalhar sem voltar ao Jellycare: o
 * site, o problema com a explicação, a evidência e o procedimento a seguir.
 * Nunca leva credenciais: essas vivem nos segredos do repositório.
 */
export function montarIssue(
  problema: ProblemaParaIssue,
  site: SiteParaIssue,
  ligacaoAoPainel: string,
): IssueMontada {
  const familia = familiaClaudeResolve(problema.code)
  if (!familia) throw new Error(`O Claude Resolve não trata ${problema.code}.`)

  const explicacao = explicacaoDe(problema.code)
  const titulo = explicacao?.titulo ?? problema.title
  const evidencia = evidenciaEmTexto(problema.evidence)

  const linhas = [
    `**${NOME_DA_FAMILIA[familia]}** · ${site.label} (${site.hostname})`,
    '',
    '## O problema',
    '',
    `- **Código:** \`${problema.code}\``,
    `- **Gravidade:** ${problema.severity}`,
    `- **Técnico:** ${problema.title}`,
    ...(problema.discriminator ? [`- **Onde:** \`${problema.discriminator}\``] : []),
    `- **Detetado:** ${problema.firstSeenAt.toISOString().slice(0, 10)}`,
    `- **Site:** ${site.url}${site.platform ? ` (${site.platform})` : ''}`,
    '',
    ...(problema.detail ? [problema.detail, ''] : []),
    ...(explicacao
      ? ['### O que é, para o cliente', '', explicacao.oQueE, '', explicacao.porqueImporta, '']
      : []),
    ...(evidencia ? ['### Evidência', '', '```json', evidencia, '```', ''] : []),
    '## O que se pede',
    '',
    `Segue o \`CLAUDE.md\` e o procedimento em \`${PROCEDIMENTO[familia]}\`.`,
    '',
    '1. Confirma o problema no site, de fora (cabeçalhos, DNS ou versões).',
    '2. Prepara a correção num pull request: o que muda, onde, como se aplica e como se desfaz.',
    '3. Se a correção não estiver em ficheiros deste repositório (painel do alojamento, DNS, backoffice), escreve no pull request os passos exatos para a equipa aplicar.',
    '4. Não apliques nada em produção. Uma pessoa da Jelly revê e aplica.',
    '',
    `Depois de aplicado, o Jellycare volta a verificar e fecha o problema sozinho: ${ligacaoAoPainel}`,
    '',
    marcaDoProblema(problema.id),
  ]

  return {
    title: `${titulo} — ${site.hostname}`,
    body: linhas.join('\n'),
    labels: [ETIQUETA_CLAUDE_RESOLVE],
  }
}

export class GitHubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubError'
  }
}

/** O endereço da API. Configurável só para os testes falarem com um GitHub falso. */
function apiDoGitHub(): string {
  return (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '')
}

/**
 * O token como o GitHub o espera. Um segredo colado num painel traz muitas
 * vezes espaços, uma mudança de linha ou as aspas do comando de onde foi
 * copiado; o GitHub recusa-o como se fosse falso.
 */
function tokenDoGitHub(): string | null {
  const valor = (process.env.GITHUB_RESOLVE_TOKEN ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  return valor || null
}

export function claudeResolveConfigurado(): boolean {
  return tokenDoGitHub() !== null
}

/**
 * Abre a issue no repositório do site.
 *
 * O token é de uma pessoa da equipa com escrita nos repositórios dos sites
 * (um token fino, só com Issues), e não de uma GitHub App: o Action do
 * Claude Code só arranca para quem tem escrita, e recusa bots que não estejam
 * autorizados um a um.
 */
export async function abrirIssue(
  repo: string,
  issue: IssueMontada,
  fetchImpl: typeof fetch = fetch,
): Promise<{ number: number; url: string }> {
  const token = tokenDoGitHub()
  if (!token) throw new GitHubError('Falta o GITHUB_RESOLVE_TOKEN nos segredos do dashboard.')

  const resposta = await fetchImpl(`${apiDoGitHub()}/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Jellycare',
    },
    body: JSON.stringify(issue),
    signal: AbortSignal.timeout(15_000),
  })

  if (!resposta.ok) {
    // As mensagens dizem o que fazer, e nunca levam o token.
    if (resposta.status === 401) {
      throw new GitHubError(
        'O GitHub não reconhece o GITHUB_RESOLVE_TOKEN. Confirme nos segredos do jellycare-web que foi colado inteiro (começa por github_pat_), e que não expirou nem foi apagado.',
      )
    }
    if (resposta.status === 403 || resposta.status === 404) {
      throw new GitHubError(
        `O token não tem acesso ao repositório ${repo}, ou o repositório não existe. Confirme o nome nas definições e que o token inclui este repositório, com permissão de Issues.`,
      )
    }
    if (resposta.status === 410) throw new GitHubError(`As issues estão desligadas em ${repo}.`)
    throw new GitHubError(`O GitHub respondeu ${resposta.status} ao abrir a issue.`)
  }

  const corpo = (await resposta.json()) as { number?: number; html_url?: string }
  if (typeof corpo.number !== 'number' || typeof corpo.html_url !== 'string') {
    throw new GitHubError('O GitHub abriu a issue mas não disse o número.')
  }
  return { number: corpo.number, url: corpo.html_url }
}
