# Worker: filas, agendador, submissão de formulários e geração de PDF.
#
# A imagem base do Playwright traz o Chromium e as bibliotecas de sistema que
# ele precisa. A etiqueta TEM de coincidir com a versão do Playwright no
# package.json — é por isso que ela está fixada numa versão exata e não num
# intervalo. Um desencontro dá "Executable doesn't exist" em produção.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jellycare/core --filter @jellycare/db --filter @jellycare/checks \
         --filter @jellycare/forms --filter @jellycare/reports --filter @jellycare/worker \
         exec tsc -p tsconfig.json
# `pnpm deploy` resolve os links do workspace numa árvore autónoma, que é o que
# permite copiar o resultado para uma imagem limpa.
#
# `--legacy` porque a partir do pnpm 10 o comando só corre em workspaces com
# `inject-workspace-packages=true`. Ligar essa opção arrumava o build mas
# estragava o desenvolvimento: as dependências do workspace passariam a ser
# cópias, e cada alteração num pacote exigiria reinstalar para se propagar.
# A flag limita a mudança ao passo que precisa dela.
RUN pnpm deploy --legacy --filter=@jellycare/worker --prod /prod/worker
RUN pnpm deploy --legacy --filter=@jellycare/db --prod /prod/db

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
# A imagem base já define PLAYWRIGHT_BROWSERS_PATH=/ms-playwright e o Playwright
# resolve o Chromium a partir daí. Fixar o caminho à mão obrigaria a acertar o
# número de build a cada atualização — exatamente o desencontro que se quer
# evitar. JELLYCARE_CHROMIUM_PATH só é preciso em imagens que não sejam esta.
ENV JELLYCARE_CHROMIUM_NO_SANDBOX=1

COPY --from=build /prod/worker ./
COPY --from=build /prod/db /app/migrations-pkg
COPY --from=build /app/packages/db/migrations /app/migrations-pkg/migrations

# As migrações correm aqui e não no dashboard: o dashboard pode ter várias
# instâncias, e duas a migrar ao mesmo tempo é problema à espera de acontecer.
CMD ["sh", "-c", "node /app/migrations-pkg/dist/migrate.js && node dist/index.js"]
