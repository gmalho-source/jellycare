# Roadmap

Faseamento pensado para ter algo vendável cedo, não para ter tudo pronto
tarde. Cada fase fecha com um produto que se pode faturar.

---

## Fase 1 — Monitor agentless (4–6 semanas)

**Objetivo:** cobrir qualquer site da carteira, sem instalar nada, e já poder
cobrar por isso.

Âmbito:
- multi-tenant com organizações, sites e verificação de propriedade do domínio
- uptime multi-região com confirmação e validação de conteúdo
- SSL, DNS, expiração de domínio, SPF/DKIM/DMARC
- blacklists e reputação (Safe Browsing, URLhaus, PhishTank)
- headers de segurança e ficheiros expostos
- crawler de links quebrados
- **teste de formulários com email canário** — o diferenciador entra já na
  Fase 1, não depois
- dashboard interno Jelly e motor de findings com deduplicação e estados
- alertas por email e Slack

Ao fim da Fase 1 a Jelly consegue pôr todos os clientes de manutenção na
plataforma, independentemente da tecnologia.

---

## Fase 2 — Relatórios e cliente (4–6 semanas)

**Objetivo:** transformar dados em entregável comercial.

Âmbito:
- portal do cliente com acesso limitado aos seus sites
- relatório mensal em PDF white-label, agendado e enviado automaticamente
- fingerprint de tecnologia e matching de CVEs com nível de confiança
- deteção de conteúdo injetado e cloaking
- Core Web Vitals com histórico
- alertas por WhatsApp e webhook
- gestão de incidentes e cálculo de SLA

Ao fim da Fase 2 o produto está completo para venda como serviço gerido.

---

## Fase 3 — Profundidade WordPress (4–6 semanas)

**Objetivo:** igualar e ultrapassar o WP-Umbrella no terreno dele.

Âmbito:
- plugin WordPress com autenticação HMAC e superfície mínima
- inventário exato de core, plugins e temas
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
