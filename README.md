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

Fase de desenho. Sem código ainda — ver roadmap para o âmbito da Fase 1.
