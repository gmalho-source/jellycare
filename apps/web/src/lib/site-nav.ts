/**
 * As secções da página de um site.
 *
 * Uma lista só, usada para desenhar a navegação e para saber que rotas
 * existem. Escrever os dois lados à mão era garantir que um dia a navegação
 * apontava para uma página que já não existe, ou que uma página nova nunca
 * aparecia no menu.
 */
export interface SiteSection {
  /** Caminho relativo à página do site. Vazio é a visão geral. */
  slug: string
  label: string
  /** Só aparece quando o site tem ligação a uma ferramenta de manutenção. */
  requiresConnector?: boolean
  /** Só aparece a quem gere a organização. */
  requiresManage?: boolean
}

export const SITE_SECTIONS: SiteSection[] = [
  { slug: '', label: 'Visão geral' },
  { slug: 'desempenho', label: 'Desempenho' },
  { slug: 'problemas', label: 'Problemas' },
  { slug: 'seguranca', label: 'Verificações' },
  { slug: 'formularios', label: 'Formulários' },
  { slug: 'wordpress', label: 'WordPress', requiresConnector: true },
  { slug: 'copias', label: 'Cópias de segurança', requiresConnector: true },
  { slug: 'relatorios', label: 'Relatórios' },
  { slug: 'definicoes', label: 'Definições' },
]

export function sectionsFor(options: {
  hasConnector: boolean
  canManage: boolean
}): SiteSection[] {
  return SITE_SECTIONS.filter((section) => {
    if (section.requiresConnector && !options.hasConnector) return false
    if (section.requiresManage && !options.canManage) return false
    return true
  })
}

export function sectionHref(siteId: string, slug: string): string {
  return slug.length === 0 ? `/sites/${siteId}` : `/sites/${siteId}/${slug}`
}
