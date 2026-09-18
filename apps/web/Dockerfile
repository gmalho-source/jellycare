# Dashboard e portal. Sem Chromium: não gera PDF nem submete formulários.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jellycare/core --filter @jellycare/db --filter @jellycare/checks \
         --filter @jellycare/forms exec tsc -p tsconfig.json
RUN pnpm --filter @jellycare/web build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# A saída standalone do Next traz apenas o que o servidor usa em execução.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# A pasta `public` existe vazia de propósito, com um .gitkeep. Sem ela este
# COPY falha o build; tirando o COPY, um ficheiro lá posto mais tarde passaria
# a servir em desenvolvimento e a desaparecer em produção, sem erro nenhum.
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
