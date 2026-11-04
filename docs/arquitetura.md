# Arquitetura

## Princípio central: duas camadas de cobertura

A decisão que define o produto todo é não depender de um plugin para nada que
seja verificável de fora.

### Camada 1 — Agentless (qualquer site, zero instalação)

Tudo o que se observa a partir do exterior, via HTTP, DNS e browser headless.
Cobre uptime, SSL, blacklists, links quebrados, headers de segurança,
fingerprint de tecnologia e CVEs associados, ficheiros expostos, deteção de
conteúdo injetado, performance e — o mais importante — o teste end-to-end de
formulários de contacto com validação de entrega de email.

Esta camada é o produto. Funciona em WordPress, Webflow, Shopify, Next.js,
Laravel, Squarespace ou HTML estático, sem pedir nada ao cliente além do URL
e da prova de propriedade do domínio.

### Camada 2 — Com acesso interno (opcional, aumenta a profundidade)

O que só se vê por dentro: inventário exato de versões, integridade de
ficheiros, scan de malware no filesystem, base de dados, utilizadores
administrativos, cron, updates e backups.

Três conectores possíveis, por ordem de esforço:

| Conector | Alvo | O que dá |
|---|---|---|
| Plugin WordPress | WP | Inventário core/plugins/temas, checksums oficiais do core, updates com rollback, scan de DB, users |
| Agente genérico | PHP, Node, qualquer servidor | Endpoint autenticado por HMAC com file integrity monitoring e scan de ficheiros |
| SFTP/SSH read-only ou Git | Qualquer, incluindo Jamstack | Baseline de hashes; em sites versionados a integridade é o próprio `git diff` |

O agente genérico é um binário Go único ou um ficheiro PHP drop-in — nunca um
framework. Quanto menos superfície, menos risco de sermos nós o vetor.

## Componentes

```
                      ┌──────────────────────────────┐
   Cliente ──────────▶│  app.jellycare.pt (Next.js)  │
   Equipa Jelly ─────▶│  dashboard + portal cliente  │
                      └───────────────┬──────────────┘
                                      │
                      ┌───────────────▼──────────────┐
                      │  API (REST + webhooks)       │
                      │  auth multi-tenant, RLS      │
                      └───────┬───────────────┬──────┘
                              │               │
                ┌─────────────▼──┐     ┌──────▼───────────┐
                │ Postgres        │     │ Redis + BullMQ  │
                │ (Neon/Supabase) │     │ scheduler/filas │
                └─────────────────┘     └──────┬──────────┘
                                               │
        ┌──────────────┬─────────────┬─────────┴────┬──────────────┐
        │              │             │              │              │
   ┌────▼────┐  ┌──────▼─────┐ ┌─────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
   │ probe   │  │ crawler    │ │ browser    │ │ intel      │ │ reporter   │
   │ uptime  │  │ links      │ │ Playwright │ │ CVE/black  │ │ PDF/email  │
   │ SSL/DNS │  │ conteúdo   │ │ forms/CWV  │ │ lists      │ │ mensal     │
   └─────────┘  └────────────┘ └────────────┘ └────────────┘ └────────────┘
                                      │
                              ┌───────▼────────┐
                              │ inbox canária   │
                              │ (Mailgun/CF)    │
                              └─────────────────┘
```

## Stack proposta

**Monorepo** Turborepo com `apps/web`, `apps/api`, `apps/worker` e packages
partilhados (`packages/checks`, `packages/db`, `packages/report`).

- **Frontend e portal:** Next.js 15 (App Router), TypeScript, Tailwind,
  shadcn/ui. Sistema visual Jelly aplicado ao dashboard e aos relatórios.
- **API:** route handlers do Next para o CRUD, serviço separado apenas se o
  volume o exigir. Não começar com microserviços.
- **Base de dados:** Postgres (Neon ou Supabase), Drizzle ORM, RLS para
  isolamento multi-tenant. Resultados de checks em tabela particionada por mês
  — é série temporal e cresce depressa.
- **Filas e agendamento:** BullMQ sobre Redis. Temporal só se os workflows de
  update com rollback justificarem; para o resto é excesso.
- **Workers:** containers separados por tipo de trabalho. O worker de browser
  precisa de imagem com Chromium (Playwright) e é o mais caro — isolá-lo
  permite escalar só essa peça.
- **Infra:** Hetzner + Coolify (custo) ou Fly.io (simplicidade e multi-região).

### Correr uma segunda região

Uma segunda instância do worker, contra a mesma base de dados e o mesmo Redis,
noutra região do Fly:

1. em `fly/worker.toml`, `JELLYCARE_REGIONS = "eu-central,eu-paris"`, e deploy;
2. **só depois**, `fly machine clone <id-da-máquina-de-fra> --region cdg --vm-memory 512 -a jellycare-worker`.

Madrid (`mad`) estava prevista, mas o Fly descontinuou-a e não aceita máquinas
novas. As filas de uptime de regiões que saem da lista são apagadas pela região
principal no arranque (`removeStaleUptimeQueues`).

A região de cada máquina vem do `FLY_REGION` (`fra` → `eu-central`, `cdg` →
`eu-paris`; `JELLYCARE_REGION` sobrepõe-se, se for preciso). A primeira região
da lista é a **principal**: corre o agendador, todas as outras verificações, os
relatórios, a retenção e as migrações. As restantes são **só probes de
disponibilidade** — de propósito: uma probe secundária que corresse também as
verificações de segurança ia pedir os mesmos ficheiros sensíveis, acabar na
mesma lista negra da firewall do alojador, e passava a haver dois IPs a pôr em
lista branca. A probe pode ser uma máquina pequena (512 MB chegam).

Com várias regiões, o agendador enfileira cada verificação de disponibilidade
**uma vez por região**, na fila dessa região (`uptime-<região>`), e cada worker
lê só a sua. Antes, as instâncias partilhavam a fila e cada job ia parar a uma
delas ao acaso: a segunda opinião só existia quando calhava. Com uma região só
não há filas de uptime — tudo corre na fila principal, como sempre.

Cada execução grava uma amostra em `uptime_samples` com a sua região. Quando
uma região não alcança o site, o worker olha para a observação **mais recente**
de cada outra região, dos últimos dez minutos:

- outra região também não alcança → mantém-se `site_down`, crítico
- outra região alcança → o finding passa a `site_unreachable_from_region`,
  severidade média, com a região em falha no discriminator
- não há amostras recentes de mais nenhuma região → mantém-se `site_down`,
  que é o comportamento correto para quem corre uma região só

Três regras impedem as duas probes de se contradizerem uma à outra:

- **Os findings de uma região são dessa região.** `site_unreachable_from_region`
  e o `monitor_blocked` de uma firewall de CDN só são resolvidos pela região
  que os viu (`findingRegion` em `@jellycare/core`). Sem isto, cada run da
  região saudável resolvia o bloqueio da outra, e ele abria e fechava de cinco
  em cinco minutos sem nunca confirmar. Se uma região for desligada, os
  findings que deixar abertos têm de ser fechados à mão.
- **O SLA junta as regiões no tempo** (`mergeRegionSamples` em
  `@jellycare/reports`): o site está em cima se alguma região o viu em cima na
  observação mais recente. Contadas uma a uma, uma região barrada e outra que
  vê o site davam uma interrupção de dois minutos e meio a cada cinco. Uma
  queda verdadeira começa a contar quando a segunda região a confirma.
- **As percentagens rápidas do painel** contam por região e ficam com a melhor
  (`bestRegionCount`), pela mesma razão.

A segunda opção é a que evita o falso positivo mais caro destas plataformas:
avisar o cliente de que o site caiu quando o que se partiu foi o caminho de
rede entre a probe e o site. E não o faz calando o problema — uma geo-restrição
ou uma borda de CDN em baixo continua a aparecer no painel.
- **Email:** Resend ou Postmark para transacional e relatórios. Inbox canária
  em domínio separado (`check.jellycare.pt`) com Cloudflare Email Workers ou
  Mailgun Routes a entregar por webhook.
- **PDF:** template HTML renderizado por Playwright em print-to-PDF. Mesmo
  pipeline já usado nas propostas Jelly.
- **Auth:** Auth.js ou Clerk. Cliente entra num portal com scope limitado aos
  seus sites.
- **Alertas:** email, Slack, WhatsApp (via flows já existentes na Jelly) e
  webhook genérico.

## Modelo de dados (núcleo)

```
organizations          tenants (clientes da Jelly)
sites                  url, stack detetada, plano, estado, org_id
site_verifications     prova de propriedade (DNS TXT ou ficheiro)
connectors             tipo (wp_plugin | agent | sftp | git), credenciais cifradas
checks                 definição: tipo, periodicidade, config, ativo
check_runs             execução: check_id, started_at, status, duration, região
findings               resultado acionável: severidade, tipo, detalhe, estado
                       (open | acknowledged | resolved | ignored), primeira e
                       última observação — deduplicado por fingerprint
incidents              agregação de findings/downtime para SLA e relatório
forms                  formulário descoberto ou configurado, seletores, campos
form_runs              submissão canária: enviado, confirmado on-page, email
                       recebido, latência, pasta (inbox/spam)
reports                mensal, período, PDF gerado, enviado a, quando
notifications          canal, destinatário, política de escalonamento
```

A tabela `findings` com estado e fingerprint é o que evita o problema clássico
destas ferramentas: 400 alertas por dia sobre a mesma coisa. Um finding só
volta a notificar se mudar de severidade ou reaparecer depois de resolvido.

## Agendamento

Rotinas diárias por defeito, com periodicidades diferenciadas por custo:

- uptime: 1–5 min (probe leve, HTTP HEAD/GET)
- SSL, DNS, blacklists, headers, ficheiros expostos: diário
- CVE matching contra inventário: diário, e re-avaliação imediata quando entra
  CVE nova nos feeds
- crawl de links quebrados: semanal por defeito, diário nos planos superiores
  (é a rotina mais cara em largura de banda)
- formulários: diário, sempre à mesma hora, com janela configurável
- Core Web Vitals: semanal
- relatório: mensal, dia configurável

O scheduler distribui os jobs ao longo da janela para não criar picos e para
não bater todos os sites do mesmo alojamento ao mesmo tempo.
