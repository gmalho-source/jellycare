# Jellycare

Plataforma de manutenção ativa e proativa de websites — produto Jelly.

Monitorização contínua, deteção de malware e vulnerabilidades, validação de
formulários de contacto e entrega de email, deteção de links quebrados e
relatórios mensais white-label para o cliente. Agnóstica de tecnologia:
funciona em WordPress, mas também em Next.js, Webflow, Shopify, Laravel,
sites estáticos ou qualquer stack acessível por HTTP.

## Porquê

As ferramentas de referência do mercado (WP-Umbrella, ManageWP, MainWP) são
excelentes mas presas ao ecossistema WordPress, porque dependem de um plugin
para fazer o trabalho todo. O carteira de clientes de uma agência não é só
WordPress. A Jellycare separa o produto em duas camadas: o que se consegue
verificar de fora (funciona em qualquer site) e o que exige acesso interno
(plugin ou agente, opcional e por stack).

## Diferenciadores

1. **Agnóstica de stack.** 80% do valor entrega-se sem instalar nada no site.
2. **Teste real de formulários e email.** Submissão automatizada com dados
   canário e confirmação de que a notificação chegou mesmo à inbox — e não ao
   spam. Nenhuma das ferramentas do mercado faz isto bem.
3. **Relatórios white-label Jelly.** O relatório mensal é um entregável
   comercial, não um dump de logs.
4. **Serviço, não ferramenta.** A plataforma existe para sustentar contratos
   de manutenção da Jelly, com SLA e remediação incluída.

## Documentação

- [`docs/arquitetura.md`](docs/arquitetura.md) — desenho técnico e stack
- [`docs/checks.md`](docs/checks.md) — catálogo de verificações e como cada uma funciona
- [`docs/roadmap.md`](docs/roadmap.md) — faseamento e âmbito de cada release
- [`docs/riscos.md`](docs/riscos.md) — riscos legais, éticos e operacionais

## Estado

**Fase 1 implementada.** Monitorização agentless completa, teste de formulários
com email canário, worker com agendamento e alertas, e dashboard interno.

## Como correr

```bash
pnpm install
./scripts/dev-services.sh                 # Postgres e Redis locais (ou docker compose up -d)
cp .env.example .env                      # e preencha DATABASE_URL e REDIS_URL

pnpm --filter @jellycare/db db:migrate
DATABASE_URL=… SEED_EMAIL=você@jelly.pt pnpm --filter @jellycare/db exec tsx src/seed.ts

pnpm dev                                  # dashboard em localhost:3000
pnpm --filter @jellycare/worker dev       # agendador e execução de verificações
```

Testes: `pnpm test`. Os testes de integração precisam de Postgres e Redis
(`TEST_DATABASE_URL`, `TEST_REDIS_URL`); os de browser usam Chromium via
Playwright.

> **Uma nota sobre a base de dados de testes.** Os pacotes correm em paralelo
> contra a mesma base de dados, por isso um teste nunca pode afirmar contagens
> globais. Foi essa a causa de uma falha intermitente que resistiu dias: os
> testes do agendador contavam a fila inteira, mas o `tick` é global por
> desenho — varre os check configs de todos os sites — e apanhava também o
> trabalho dos testes de outros pacotes. Nunca reproduzia isolada porque
> sozinha não há mais ninguém a escrever na base de dados. Um teste mede o
> site, a organização ou o utilizador que ele próprio cria; nunca o total.

## Estrutura

```
apps/web        dashboard e portal (Next.js 15, App Router)
apps/worker     agendador, execução de verificações e alertas (BullMQ)
packages/core   domínio partilhado: severidades, findings, contrato dos checks
packages/db     schema Drizzle, migrações e repositórios
packages/checks verificações agentless
packages/forms  descoberta, submissão canária e validação de entrega de email
```
