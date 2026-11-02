/** @type {import('next').NextConfig} */
export default {
  // Os pacotes do monorepo são TypeScript por compilar; o Next transpila-os.
  transpilePackages: ['@jellycare/core', '@jellycare/db', '@jellycare/checks'],
  // Saída autónoma: o servidor leva só o que usa em execução, o que mantém a
  // imagem pequena e o arranque rápido.
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  // Cabeçalho de marketing — não acrescenta segurança nem valor ao cliente.
  poweredByHeader: false,
  // `marked` tem muitos entrypoints; isto evita puxar o pacote inteiro para
  // o grafo só porque se importa um símbolo.
  experimental: {
    optimizePackageImports: ['marked'],
  },
  async headers() {
    // Os woff2 em `/public/fonts` têm conteúdo endereçado pelo nome do
    // ficheiro (peso + subset). Podem viver na cache do browser um ano:
    // sem isto o Next servia `max-age=0` e cada visita voltava a baixar
    // dezenas de kilobytes de tipografia.
    const immutable = [
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ]
    return [
      { source: '/fonts/:path*', headers: immutable },
      { source: '/email/:path*', headers: immutable },
      {
        source: '/jellycare.svg',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/icon.svg',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ]
  },
}
