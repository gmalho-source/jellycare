/** @type {import('next').NextConfig} */
export default {
  // Os pacotes do monorepo são TypeScript por compilar; o Next transpila-os.
  transpilePackages: ['@jellycare/core', '@jellycare/db', '@jellycare/checks'],
  // Saída autónoma: o servidor leva só o que usa em execução, o que mantém a
  // imagem pequena e o arranque rápido.
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
}
