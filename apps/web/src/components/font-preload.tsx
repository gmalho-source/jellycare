/**
 * Arranque dos tipos de letra críticos.
 *
 * O CSS só começa a pedir o ficheiro quando encontra texto que o usa; até
 * lá o browser já pintou com o fallback e o utilizador vê a troca. Um
 * `preload` no documento pede o woff2 em paralelo com o CSS, o que corta
 * essa janela sem mudar o aspeto.
 *
 * `crossOrigin` é obrigatório: sem ele o preload e o `@font-face` não
 * partilham a cache, e o browser descarregava o mesmo ficheiro duas vezes.
 */

export function FontPreload({ hrefs }: { hrefs: readonly string[] }) {
  return (
    <>
      {hrefs.map((href) => (
        <link
          key={href}
          rel="preload"
          href={href}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      ))}
    </>
  )
}

/** Painel interno: o texto corre em Plex Sans 400; os títulos em Space Grotesk. */
export const FONTES_APP = [
  '/fonts/plex-sans-400-latin.woff2',
  '/fonts/space-grotesk-500-700-latin.woff2',
] as const

/** Corpo do tema Jelly — chega no login e em qualquer página com `.tema-jelly`. */
export const FONTES_PORTAL_CORPO = ['/fonts/poppins-400-latin.woff2'] as const

/** Títulos em Bree Serif — só onde há `font-display` (portal e legal, não o login). */
export const FONTES_PORTAL_TITULOS = ['/fonts/bree-serif-400-latin.woff2'] as const

export const FONTES_PORTAL = [...FONTES_PORTAL_CORPO, ...FONTES_PORTAL_TITULOS] as const
