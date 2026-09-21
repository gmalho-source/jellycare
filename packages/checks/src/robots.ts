/**
 * Parser de robots.txt.
 *
 * Um crawler que ignora robots.txt acaba com o IP em blacklists e sobrecarrega
 * o alojamento do cliente — precisamente o oposto do que um produto de
 * manutenção deve fazer. Ver docs/riscos.md.
 */

export interface RobotsRule {
  type: 'allow' | 'disallow'
  pattern: string
}

export interface RobotsGroup {
  userAgents: string[]
  rules: RobotsRule[]
  crawlDelaySeconds?: number
}

export interface RobotsTxt {
  groups: RobotsGroup[]
  sitemaps: string[]
}

export function parseRobotsTxt(content: string): RobotsTxt {
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []

  let current: RobotsGroup | null = null
  // Linhas User-agent consecutivas partilham o mesmo grupo de regras.
  let acceptingAgents = false

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue

    const separator = line.indexOf(':')
    if (separator === -1) continue

    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    switch (field) {
      case 'user-agent': {
        if (!current || !acceptingAgents) {
          current = { userAgents: [], rules: [] }
          groups.push(current)
          acceptingAgents = true
        }
        current.userAgents.push(value.toLowerCase())
        break
      }
      case 'allow':
      case 'disallow': {
        if (!current) break
        acceptingAgents = false
        current.rules.push({ type: field, pattern: value })
        break
      }
      case 'crawl-delay': {
        if (!current) break
        acceptingAgents = false
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed >= 0) current.crawlDelaySeconds = parsed
        break
      }
      case 'sitemap': {
        sitemaps.push(value)
        break
      }
    }
  }

  return { groups, sitemaps }
}

/**
 * Grupo aplicável ao nosso user-agent.
 *
 * Uma regra dirigida ao nome exato ganha sempre ao `*`, mesmo que apareça
 * depois no ficheiro.
 */
export function groupFor(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const token = userAgent.toLowerCase()

  for (const group of robots.groups) {
    if (group.userAgents.some((agent) => agent !== '*' && token.includes(agent))) return group
  }

  return robots.groups.find((group) => group.userAgents.includes('*')) ?? null
}

/** Converte um padrão de robots.txt, com `*` e `$`, numa expressão regular. */
function patternToRegExp(pattern: string): RegExp {
  let source = ''
  for (const char of pattern) {
    if (char === '*') source += '.*'
    else if (char === '$') source += '$'
    else source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}`)
}

/**
 * O caminho é permitido para este grupo?
 *
 * Regra da norma: vence o padrão mais longo; em empate, `Allow` ganha a
 * `Disallow`. Um `Disallow:` vazio não proíbe nada.
 */
export function isAllowed(group: RobotsGroup | null, path: string): boolean {
  if (!group) return true

  let best: { rule: RobotsRule; length: number } | null = null

  for (const rule of group.rules) {
    if (rule.pattern === '') {
      // "Disallow:" vazio significa permitir tudo; "Allow:" vazio não diz nada.
      continue
    }
    if (!patternToRegExp(rule.pattern).test(path)) continue

    const length = rule.pattern.length
    if (!best || length > best.length || (length === best.length && rule.type === 'allow')) {
      best = { rule, length }
    }
  }

  return best ? best.rule.type === 'allow' : true
}

export interface RobotsPolicy {
  isAllowed: (url: string) => boolean
  crawlDelayMs: number
}

/**
 * Política pronta a usar pelo crawler. Um robots.txt inacessível ou ilegível
 * resulta em "tudo permitido", que é o comportamento convencionado.
 */
export function buildPolicy(
  content: string | null,
  userAgent: string,
  defaultDelayMs: number,
): RobotsPolicy {
  if (content === null) {
    return { isAllowed: () => true, crawlDelayMs: defaultDelayMs }
  }

  const robots = parseRobotsTxt(content)
  const group = groupFor(robots, userAgent)
  const declaredDelay = group?.crawlDelaySeconds

  return {
    isAllowed: (url: string) => {
      try {
        const parsed = new URL(url)
        return isAllowed(group, `${parsed.pathname}${parsed.search}`)
      } catch {
        return false
      }
    },
    // Respeitar sempre o maior dos dois: se o site pede mais lentidão do que a
    // nossa, é a dele que vale.
    crawlDelayMs: Math.max(defaultDelayMs, (declaredDelay ?? 0) * 1000),
  }
}
