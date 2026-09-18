# Alojamento e deploy

## O que a plataforma exige

Antes de escolher fornecedores, o que o código realmente precisa:

| Peça | Exigência | Porquê |
|---|---|---|
| `apps/web` | Node, leituras à base de dados | Renderização no servidor; o bundle de servidor são 2,9 MB |
| `apps/worker` | **Processo permanente e Chromium** | Fila BullMQ, agendador em ciclo, submissão de formulários e geração de PDF |
| Postgres | Região UE, ligações estáveis | Toda a persistência, incluindo os PDF dos relatórios |
| Redis | Comandos bloqueantes | BullMQ depende deles |
| Email de saída | Anexos | Alertas e relatório mensal com PDF |
| Email de entrada | Reencaminhamento por webhook | Caixa de verificação dos formulários |

A exigência que decide tudo é a segunda. O worker não é uma função que arranca
e morre: tem um ciclo de agendamento, mantém uma instância de Chromium viva
entre submissões, e corre uma passagem horária de relatórios. Isso exclui
qualquer plataforma exclusivamente serverless para essa peça.

## Recomendação

**Fly.io para as duas aplicações, Neon para Postgres, Upstash para Redis,
Resend para email de saída, Cloudflare Email Routing para o de entrada.**

### Porquê Fly.io

- Corre containers com processos permanentes, que é o que o worker é.
- A segunda região de monitorização é um comando, não uma arquitetura nova.
  A corroboração entre regiões está implementada e à espera disso: basta uma
  segunda máquina com `JELLYCARE_REGION` diferente.
- Máquinas com memória suficiente para o Chromium sem pagar por uma VPS inteira.
- Regiões europeias (`mad`, `cdg`, `ams`) — relevante para latência e para o RGPD.

Pôr o dashboard no mesmo sítio evita gerir duas plataformas, dois conjuntos de
variáveis de ambiente e dois modelos de ligação à base de dados.

### Porquê Neon e não Supabase

O Supabase é Postgres mais autenticação, armazenamento e edge functions. Não
usamos nenhuma das três: a autenticação é por ligação de uso único contra as
nossas próprias tabelas, os PDF estão na base de dados, e não há edge
functions. Ficaria a ser "só Postgres" com superfície a mais para manter.

O Neon dá o mesmo Postgres com duas coisas que interessam aqui: ramificação da
base de dados, que torna um ambiente de testes trivial, e suspensão automática,
que faz o custo acompanhar o uso real. Se houvesse vontade de usar o Supabase
pelo ecossistema, a troca é a string de ligação — nada no código depende do
fornecedor.

### Porquê não Vercel para o dashboard

O Vercel seria a escolha óbvia se o dashboard fosse a aplicação toda. Não é —
é a metade que não tem os requisitos difíceis. Pô-lo lá significa gerir duas
plataformas para poupar pouco, e obriga a cuidados com o agrupamento de
ligações que no Fly não existem.

É uma escolha defensável, não um erro: se a equipa valorizar as
pré-visualizações por pull request, o dashboard no Vercel e o worker no Fly
funciona. O `apps/web` já não arrasta o Playwright, por isso o build é leve.

### Alternativa mais barata: Hetzner com Coolify

Uma VPS a correr tudo custa uma fração. A conta que interessa não é essa: passa
a haver um servidor para atualizar, monitorizar e recuperar, e a segunda região
de monitorização deixa de ser um comando. Para uma agência sem alguém dedicado
a infraestrutura, isso troca dinheiro por tempo na direção errada no início.
Faz sentido quando a carteira crescer e a fatura começar a doer.

## Ordem de grandeza do custo

Para vinte a cinquenta sites, por mês:

| | |
|---|---|
| Fly.io — dashboard + dois workers | 25–40 € |
| Neon | 0–25 € |
| Upstash Redis | 0–10 € |
| Resend | 0–20 € |
| Cloudflare Email Routing | grátis |
| **Total** | **≈ 50–90 €** |

Os preços mudam e estes valores são de ordem de grandeza, não orçamento:
confirmar nos sites dos fornecedores antes de decidir. O que não muda é a
proporção — o worker é a peça cara, porque é a que corre sempre e a que precisa
de memória para o Chromium.

## Notas de configuração

**Chromium no worker.** A imagem tem de trazer o browser e as suas bibliotecas.
O caminho mais curto é partir da imagem oficial do Playwright e apontar
`JELLYCARE_CHROMIUM_PATH` para o binário. Reservar pelo menos 1 GB de memória
para a máquina do worker; o Chromium sozinho consome várias centenas de MB.
Definir `JELLYCARE_CHROMIUM_NO_SANDBOX=1` em containers sem user namespaces.

**Dashboard sem Chromium.** O `apps/web` não gera PDF nem submete formulários —
isso é tudo do worker. O `@jellycare/forms/browser` é um subcaminho próprio
precisamente para que o barrel não arraste o Playwright para o build do
dashboard.

**Migrações.** Correr `drizzle-kit migrate` no arranque do worker, não do
dashboard: o dashboard pode ter várias instâncias e duas migrações em paralelo
é problema à espera de acontecer.

**Caixa de verificação.** Registar `check.jellycare.pt` — domínio separado do
principal, com reputação própria. O Cloudflare Email Routing reencaminha para
um Worker que assina o corpo com `CANARY_INBOX_WEBHOOK_SECRET` e faz POST para
`/api/inbound-email`. O esquema de assinatura está em `docs/checks.md`.

**Segunda região.** Uma segunda máquina do worker, mesma base de dados, mesmo
Redis, `JELLYCARE_REGION` diferente. Nada mais — a lógica de corroboração está
descrita em `docs/arquitetura.md`.

**Antes de pôr clientes reais.** Verificação de propriedade do domínio ativa
(já é obrigatória no código), DPA assinado com cada cliente, e a política de
retenção de `docs/riscos.md` implementada como tarefa de limpeza — ainda não
está.
