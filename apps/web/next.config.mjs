/** @type {import('next').NextConfig} */
export default {
  // Os pacotes do monorepo são TypeScript por compilar; o Next transpila-os.
  transpilePackages: ['@jellycare/core', '@jellycare/db', '@jellycare/checks'],
  experimental: { typedRoutes: false },
}
