# Autenticação do email: SPF e DMARC

Problemas: `spf_missing`, `spf_permissive`, `spf_duplicated`,
`dmarc_missing`, `dmarc_policy_none`, `dmarc_partial`.

Mexer aqui às cegas manda email verdadeiro do cliente para o spam. Antes de
propor um registo, lista **tudo o que envia em nome do domínio**: o
`email.fornecedor` e o `email.envia_tambem` do `site.yml`, mais o que se vê no
SPF atual. Se a lista não estiver completa, pergunta na issue antes de
continuar.

## SPF

- **Um só** registo `TXT` a começar por `v=spf1` (`spf_duplicated` é haver dois:
  junta-os num).
- Um `include:` por serviço que envia: Google Workspace
  `include:_spf.google.com`, Microsoft 365 `include:spf.protection.outlook.com`,
  e os de cada serviço da lista (procura o valor na documentação oficial de cada
  um e cita-a no pull request).
- Termina em `~all`. `-all` só depois de o DMARC mostrar que tudo passa. Nunca
  `+all` (`spf_permissive`).
- No máximo 10 consultas DNS (`include`, `a`, `mx`, `redirect`): conta-as no
  pull request.

## DMARC

Registo `TXT` em `_dmarc.dominio`, sempre por fases:

1. `v=DMARC1; p=none; rua=mailto:dmarc@dominio` — só observa.
2. `p=quarantine; pct=25`, depois `pct=100`, depois de duas semanas de
   relatórios limpos.
3. `p=reject`.

`dmarc_policy_none` é estar na fase 1 há tempo demais: propõe a fase 2 se os
relatórios estiverem limpos, ou diz o que falta para lá chegar.
`dmarc_partial` é um `pct` abaixo de 100 parado: o mesmo raciocínio.

## Como se entrega

Em `config/dns/registos.md`: tabela com tipo, nome, valor antes e valor
depois, e os passos no painel do `dns.fornecedor`. Se o DNS for do Cloudflare,
os registos de email ficam **sem proxy** (nuvem cinzenta).

## Confirmar

`dig +short TXT dominio` e `dig +short TXT _dmarc.dominio`. A propagação pode
levar até ao TTL do registo antigo.
