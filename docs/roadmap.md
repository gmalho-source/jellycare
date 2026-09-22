# Roadmap

Faseamento pensado para ter algo vendável cedo, não para ter tudo pronto
tarde. Cada fase fecha com um produto que se pode faturar.

---

## Fase 1 — Monitor agentless — IMPLEMENTADA

**Objetivo:** cobrir qualquer site da carteira, sem instalar nada, e já poder
cobrar por isso.

Âmbito:
- multi-tenant com organizações, sites e verificação de propriedade do domínio
- uptime multi-região com confirmação e validação de conteúdo
- SSL, DNS, expiração de domínio, SPF/DKIM/DMARC
- blacklists e reputação (URLhaus, PhishTank — Safe Browsing não, por licença)
- headers de segurança e ficheiros expostos
- crawler de links quebrados
- **teste de formulários com email canário** — o diferenciador entra já na
  Fase 1, não depois
- dashboard interno Jelly e motor de findings com deduplicação e estados
- alertas por email e Slack

Ao fim da Fase 1 a Jelly consegue pôr todos os clientes de manutenção na
plataforma, independentemente da tecnologia.

Entregue por completo, incluindo os três pontos que ficaram em aberto na
primeira passagem:

- **disponibilidade multi-região**: cada execução grava uma amostra com a sua
  região e, quando uma região não alcança o site, confronta-a com as outras.
  Ativa-se com uma segunda instância de worker e `JELLYCARE_REGION` diferente,
  sem código novo — ver `docs/arquitetura.md`
- **rotinas de formulários**: `form_discovery`, `form_test` e `form_delivery`
  estão no agendador e escrevem no inventário e no histórico de submissões
- **caixa de verificação**: `POST /api/inbound-email` recebe as mensagens do
  fornecedor de inbox, valida a assinatura e fecha o circuito da notificação —
  ver `docs/checks.md`

---

## Fase 2 — Relatórios e cliente (4–6 semanas)

**Objetivo:** transformar dados em entregável comercial.

Âmbito:
- **portal do cliente com acesso limitado aos seus sites — IMPLEMENTADO**
- **relatório mensal em PDF white-label, agendado e enviado — IMPLEMENTADO**
- fingerprint de tecnologia e matching de CVEs com nível de confiança
- deteção de conteúdo injetado e cloaking
- Core Web Vitals com histórico
- alertas por WhatsApp e webhook
- gestão de incidentes e cálculo de SLA

Ao fim da Fase 2 o produto está completo para venda como serviço gerido.

Estado: o relatório mensal está implementado de ponta a ponta — agregação com
SLA, PDF white-label, geração idempotente no dia configurado, envio por email
com o PDF anexado e acesso a partir do painel.

O portal do cliente vive em `/portal`, na mesma aplicação e com a mesma
autenticação por ligação de uso único. Quem só tem papel `client` aterra lá e
é impedido de entrar no painel interno; a equipa da Jelly pode entrar nos dois,
de propósito, porque ver o que o cliente vê antes de uma reunião vale mais do
que qualquer descrição. Mostra o estado de cada site, a disponibilidade a 30
dias com a contagem de observações em que assenta, os problemas em aberto na
linguagem com que já são escritos, o que está a ser vigiado, e os relatórios
mensais para descarregar. Não mostra configuração, tokens de verificação nem
seletores, e não tem uma única escrita.

A propriedade que o sustenta está coberta por um teste de ponta a ponta: um
cliente que abra pelo URL o site de outra organização é mandado embora.

Falta o resto do âmbito da fase: CVEs, cloaking, Core Web Vitals, WhatsApp e
gestão de incidentes.

---

## Fase 3 — Profundidade WordPress

**Objetivo revisto:** em vez de igualar o WP-Umbrella no terreno dele,
sentarmo-nos por cima dele.

A decisão mudou depois de olhar para a API pública deles: 26 endpoints com
inventário, vulnerabilidades da Patchstack e updates. Construir o nosso plugin
custava semanas e punha um segredo nosso a correr dentro do WordPress de todos
os clientes. Pela API não ocupamos essa posição, e o que nos distingue passa a
ser o que a Umbrella não faz: formulários com email canário e validação de
entrega, corroboração de uptime entre regiões, reputação, TLS, o portal do
cliente, o relatório white-label — e os sites que não são WordPress.

O custo é dependência de um terceiro e mais um subprocessador no RGPD. A
mitigação é o conector ser uma interface com uma implementação, em
`@jellycare/connectors`, e não lógica da Umbrella espalhada pelo código.

Âmbito:
- **inventário exato de plugins e temas pela API da WP Umbrella — IMPLEMENTADO**
- **vulnerabilidades com CVSS, da Patchstack — IMPLEMENTADO**
- updates geridos (`POST /projects/{id}/plugins/update`), que ficam para
  depois: escrever no site de um cliente através de um terceiro merece o mesmo
  cuidado que merecia o nosso próprio plugin
- backups e integridade de ficheiros, também disponíveis na API deles
- plugin próprio, só se algum dia a margem o justificar
- file integrity monitoring com checksums oficiais
- scan de malware no filesystem (YARA e heurísticas) e na base de dados
- updates geridos com backup, staging, regressão visual e rollback
- verificação de backups por restauro de teste

---

## Fase 4 — Cobertura universal e escala

- agente genérico (binário Go ou PHP drop-in) para stacks não-WordPress
- conector SFTP/SSH e conector Git para Jamstack
- remediação semi-automática de findings comuns
- API pública e integração com o CRM e faturação da Jelly
- eventual abertura como produto SaaS autónomo a outras agências

---

## Decisões a tomar antes de começar

Estas quatro decisões condicionam a arquitetura e devem ser fechadas antes da
primeira linha de código.

1. **Produto interno ou SaaS desde o início?** Interno permite atalhos
   (onboarding manual, faturação fora da plataforma). SaaS obriga a
   self-service, billing e suporte desde a Fase 1. A recomendação é interno
   primeiro, com o modelo de dados já multi-tenant para não bloquear a
   abertura depois.
2. **Nome e domínio.** `jellycare.pt` ou subdomínio de `jelly.pt`? O domínio da
   inbox canária deve ser separado e com reputação própria.
3. **Alojamento.** Hetzner com Coolify é significativamente mais barato para
   workers de browser; Fly.io resolve multi-região sem trabalho. A escolha
   depende do volume de sites previsto no primeiro ano.
4. **Âmbito do contrato de manutenção.** A plataforma deteta; quem corrige é a
   equipa. Definir o que está incluído no plano e o que é trabalho faturável —
   caso contrário a plataforma gera trabalho não pago.
