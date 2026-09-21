import type { CheckContext, CheckDefinition, CheckResult, ObservedFinding } from '@jellycare/core'
import { getDomain } from 'tldts'

export type TxtResolver = (hostname: string) => Promise<string[][]>

export interface EmailAuthConfig {
  /** Seletores DKIM a testar. Não há forma de os enumerar por DNS. */
  dkimSelectors?: string[]
  resolver?: TxtResolver
}

/**
 * Seletores DKIM dos fornecedores que a carteira da Jelly usa. A lista existe
 * porque o DNS não permite descobrir seletores: ou se sabe o nome, ou não se
 * consegue verificar.
 */
const COMMON_DKIM_SELECTORS = [
  'default',
  'google',
  'selector1',
  'selector2',
  'k1',
  'mail',
  'dkim',
  's1',
  's2',
]

export interface SpfAnalysis {
  found: boolean
  /** Mais do que um registo SPF invalida a política toda (RFC 7208). */
  duplicated: boolean
  record?: string
  /** `+all` autoriza o mundo inteiro a enviar em nome do domínio. */
  allowsAll: boolean
  /** `~all` ou `-all`. */
  qualifier?: '+' | '-' | '~' | '?'
}

export function analyzeSpf(records: string[][]): SpfAnalysis {
  const flattened = records.map((chunks) => chunks.join(''))
  const spfRecords = flattened.filter((record) => record.toLowerCase().startsWith('v=spf1'))

  if (spfRecords.length === 0) return { found: false, duplicated: false, allowsAll: false }

  const record = spfRecords[0] as string
  const match = /([+\-~?]?)all\b/i.exec(record)
  const qualifier = (match?.[1] || '+') as '+' | '-' | '~' | '?'

  const analysis: SpfAnalysis = {
    found: true,
    duplicated: spfRecords.length > 1,
    record,
    allowsAll: Boolean(match) && qualifier === '+',
  }
  if (match) analysis.qualifier = qualifier
  return analysis
}

export interface DmarcAnalysis {
  found: boolean
  record?: string
  policy?: 'none' | 'quarantine' | 'reject'
  /** Percentagem de mensagens a que a política se aplica. */
  percentage?: number
}

export function analyzeDmarc(records: string[][]): DmarcAnalysis {
  const flattened = records.map((chunks) => chunks.join(''))
  const record = flattened.find((value) => value.toLowerCase().startsWith('v=dmarc1'))
  if (!record) return { found: false }

  const policy = /\bp\s*=\s*(none|quarantine|reject)\b/i.exec(record)?.[1]?.toLowerCase()
  const percentage = /\bpct\s*=\s*(\d{1,3})\b/i.exec(record)?.[1]

  const analysis: DmarcAnalysis = { found: true, record }
  if (policy) analysis.policy = policy as DmarcAnalysis['policy']
  if (percentage) analysis.percentage = Number(percentage)
  return analysis
}

async function resolveQuietly(resolver: TxtResolver, hostname: string): Promise<string[][]> {
  try {
    return await resolver(hostname)
  } catch {
    // NXDOMAIN é uma resposta legítima: o registo não existe.
    return []
  }
}

/**
 * Autenticação de email do domínio.
 *
 * Diretamente ligado ao teste de formulários: um site cujo SPF ou DMARC estão
 * mal configurados entrega as notificações de contacto no spam, e o cliente
 * conclui que "o site não gera leads".
 */
export const emailAuthCheck: CheckDefinition<EmailAuthConfig> = {
  type: 'email_auth',
  defaultIntervalMinutes: 60 * 24,
  confirmationsRequired: 1,

  async run(context: CheckContext, config: EmailAuthConfig): Promise<CheckResult> {
    const findings: ObservedFinding[] = []
    const resolver =
      config.resolver ??
      (async (hostname: string) => {
        const { resolveTxt } = await import('node:dns/promises')
        return resolveTxt(hostname)
      })

    // O email usa o domínio registável, não o hostname do site: um site em
    // www.cliente.pt envia a partir de cliente.pt.
    const domain = getDomain(context.site.hostname) ?? context.site.hostname

    const [txt, dmarcTxt] = await Promise.all([
      resolveQuietly(resolver, domain),
      resolveQuietly(resolver, `_dmarc.${domain}`),
    ])

    const spf = analyzeSpf(txt)
    if (!spf.found) {
      findings.push({
        code: 'spf_missing',
        severity: 'medium',
        title: 'O domínio não tem registo SPF',
        detail:
          'Sem SPF, qualquer servidor pode enviar email em nome do domínio e as notificações ' +
          'legítimas do site têm maior probabilidade de cair no spam.',
        evidence: { domain },
      })
    } else {
      if (spf.duplicated) {
        findings.push({
          code: 'spf_duplicated',
          severity: 'high',
          title: 'O domínio tem mais do que um registo SPF',
          detail:
            'A norma invalida a política inteira quando existem vários registos SPF. Na prática ' +
            'é o mesmo que não ter SPF nenhum.',
          evidence: { domain },
        })
      }
      if (spf.allowsAll) {
        findings.push({
          code: 'spf_permissive',
          severity: 'high',
          title: 'O SPF autoriza qualquer servidor a enviar em nome do domínio',
          detail: `O registo termina em "+all", o que anula a proteção: ${spf.record}`,
          evidence: { record: spf.record },
        })
      }
    }

    const dmarc = analyzeDmarc(dmarcTxt)
    if (!dmarc.found) {
      findings.push({
        code: 'dmarc_missing',
        severity: 'medium',
        title: 'O domínio não tem registo DMARC',
        detail:
          'Sem DMARC não há política definida para email que falha autenticação, nem relatórios ' +
          'de quem está a tentar enviar em nome do domínio.',
        evidence: { domain },
      })
    } else if (dmarc.policy === 'none') {
      findings.push({
        code: 'dmarc_policy_none',
        severity: 'low',
        title: 'A política DMARC está em modo de observação',
        detail:
          'Com p=none o DMARC só produz relatórios; não impede ninguém de enviar email em nome ' +
          'do domínio. É o passo intermédio correto, mas não é o destino.',
        evidence: { record: dmarc.record },
      })
    } else if (dmarc.percentage !== undefined && dmarc.percentage < 100) {
      findings.push({
        code: 'dmarc_partial',
        severity: 'low',
        title: `A política DMARC só se aplica a ${dmarc.percentage}% das mensagens`,
        detail: 'O restante passa sem verificação.',
        evidence: { record: dmarc.record, percentage: dmarc.percentage },
      })
    }

    const selectors = config.dkimSelectors ?? COMMON_DKIM_SELECTORS
    const dkimResults = await Promise.all(
      selectors.map(async (selector) => {
        const records = await resolveQuietly(resolver, `${selector}._domainkey.${domain}`)
        const found = records.some((chunks) => chunks.join('').toLowerCase().includes('p='))
        return { selector, found }
      }),
    )
    const dkimFound = dkimResults.filter((result) => result.found)

    if (dkimFound.length === 0) {
      findings.push({
        code: 'dkim_not_found',
        severity: 'low',
        title: 'Não foi encontrado nenhum registo DKIM nos seletores conhecidos',
        detail:
          'O DNS não permite enumerar seletores DKIM, por isso isto não prova a ausência de ' +
          `DKIM — só que nenhum dos ${selectors.length} seletores testados existe. Se o cliente ` +
          'usa um seletor próprio, configure-o para silenciar este aviso.',
        evidence: { domain, selectorsTried: selectors },
      })
    }

    return {
      findings,
      metrics: {
        spfPresent: spf.found ? 1 : 0,
        dmarcPresent: dmarc.found ? 1 : 0,
        dkimSelectorsFound: dkimFound.length,
      },
    }
  },
}
