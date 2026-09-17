# Catálogo de verificações

Para cada verificação: o que faz, como é feita tecnicamente, e se precisa de
acesso interno ao site.

---

## 1. Malware e reputação

### 1.1 Blacklists e reputação de domínio — agentless
Consulta diária a Google Safe Browsing API, URLhaus (abuse.ch), PhishTank,
Spamhaus DBL e VirusTotal URL report. Se o domínio ou qualquer URL do site
aparece marcado, é incidente crítico imediato — perder o ranking no Google por
"este site pode ser perigoso" custa mais ao cliente do que o próprio malware.

### 1.2 Deteção de conteúdo injetado — agentless
Análise do HTML e dos scripts servidos, à procura de:
- JavaScript ofuscado (`eval`, `atob`, `String.fromCharCode` encadeado,
  entropia anormal em strings)
- iframes ocultos (`display:none`, 1x1px) para domínios externos
- scripts de domínios não presentes na baseline aprovada do site
- injeção de SEO spam (blocos de links escondidos, keywords de farmácia/casino
  em `position:absolute; left:-9999px`)
- redirects condicionais por `Referer` do Google ou `User-Agent` mobile

### 1.3 Cloaking — agentless
O truque mais usado em sites WordPress comprometidos: o site serve conteúdo
limpo ao visitante normal e conteúdo spam ao Googlebot. Deteta-se pedindo a
mesma página três vezes — como browser normal, como Googlebot e como mobile
com referrer do Google — e comparando. Divergência estrutural = alerta.

### 1.4 Defacement e alteração inesperada — agentless
Hash do DOM normalizado (removendo elementos voláteis: datas, contadores,
nonces) das páginas-chave. Alteração fora de janela de deploy conhecida gera
finding informativo; alteração com padrões suspeitos gera crítico.

### 1.5 Scan de ficheiros — requer acesso interno
Com plugin WP, agente ou SFTP:
- checksums do core WordPress contra a API oficial (`api.wordpress.org`)
- baseline de hashes para temas, plugins e código custom; alteração detetada
- regras YARA e assinaturas para webshells conhecidas
- heurísticas em PHP: `eval(base64_decode(`, `gzinflate`, `preg_replace` com
  modificador `/e`, `assert`, ficheiros PHP em `wp-content/uploads`
- ficheiros novos em diretórios que não deviam ter escrita
- scan da base de dados: `wp_options` com conteúdo serializado suspeito,
  utilizadores administrativos criados fora do fluxo normal, cron jobs injetados

---

## 2. Vulnerabilidades

### 2.1 Fingerprint de tecnologia — agentless
Identificação da stack por headers, `<meta name="generator">`, caminhos e
assinaturas conhecidas (lógica tipo Wappalyzer). Em WordPress, deteção de
versões de plugins e temas por `readme.txt`, `style.css`, query strings de
assets e ficheiros estáticos com versão no path.

### 2.2 Matching de CVEs — agentless (preciso) / interno (exato)
As versões detetadas cruzam-se com:
- **OSV.dev** e **NVD** para bibliotecas e frameworks genéricos
- **WPScan API** ou **wpvulnerability** para o ecossistema WordPress
- feeds de vulnerabilidades de Shopify apps, extensões Magento, pacotes npm
  expostos no bundle

O fingerprint externo dá probabilidade; o inventário via conector dá certeza.
Reportar sempre com nível de confiança — nunca alarmar o cliente com um falso
positivo de versão.

### 2.3 Configuração e superfície exposta — agentless
Verificações não intrusivas, sem exploração:
- headers de segurança: CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy
- mixed content em HTTPS
- directory listing ativo
- ficheiros que não deviam estar acessíveis: `.env`, `.git/HEAD`, `.DS_Store`,
  `wp-config.php.bak`, `*.sql`, `backup.zip`, `phpinfo.php`, `/debug.log`
- `xmlrpc.php` acessível, enumeração de utilizadores via `/wp-json/wp/v2/users`
- versões de servidor expostas em headers

**Limite explícito:** a plataforma faz reconhecimento passivo e pedidos
não destrutivos. Não executa exploits, não testa injeção, não força
autenticação. Ver `docs/riscos.md`.

### 2.4 SSL, DNS e domínio — agentless
Validade e cadeia do certificado com aviso a 30, 14 e 7 dias; algoritmo e
tamanho de chave; expiração do domínio via RDAP/WHOIS; registos SPF, DKIM e
DMARC (diretamente ligado ao ponto 4); alterações inesperadas nos registos A,
CNAME, MX e NS.

---

## 3. Links quebrados

Crawler próprio, respeitando `robots.txt`, com `User-Agent: JellycareBot/1.0
(+https://jellycare.pt/bot)`, concorrência limitada e budget de páginas por
plano.

- links internos: `GET` com validação de estado; 404, 410 e 5xx são findings
- links externos: `HEAD` primeiro, `GET` de fallback (muitos servidores
  rejeitam `HEAD`), com confirmação num segundo run antes de alertar — links
  externos falham por rate limit e geram ruído se alertarem à primeira
- imagens e assets em falta, incluindo `srcset`
- cadeias de redirect longas e loops
- links para `http://` em páginas `https://`
- âncoras internas inexistentes

Cada finding traz a página de origem e o texto da âncora — sem isso o cliente
não consegue corrigir.

---

## 4. Formulários e entrega de email

A verificação mais valiosa e a que o mercado não faz bem.

### Descoberta
Durante o crawl, identificação de `<form>` com campos de contacto, e deteção
de formulários renderizados por JavaScript (Contact Form 7, WPForms, Gravity
Forms, Typeform embebido, HubSpot, componentes React). Formulários também
podem ser configurados manualmente com seletores.

### Submissão canária
Playwright preenche o formulário com dados identificáveis:

- nome: `Jellycare Monitor`
- email: `check+<site_id>+<run_id>@check.jellycare.pt`
- mensagem: texto fixo com o token do run e indicação clara de que é um teste
  automático de monitorização

Resolve captcha? Não. Se o formulário tem reCAPTCHA v2 ou hCaptcha, a solução
correta é o cliente adicionar o IP das probes a uma allowlist ou um header
secreto que a integração reconhece — nunca tentar contornar a proteção.
Com reCAPTCHA v3 e Turnstile a submissão normalmente passa.

### Validação em três níveis
1. **Submissão aceite:** mensagem de sucesso, redirect para thank-you page, ou
   resposta HTTP esperada. Deteta o caso clássico do formulário que dá erro
   silencioso depois de um update de plugin.
2. **Notificação recebida:** a inbox canária recebe o email? Medição da
   latência entre submissão e chegada. Sem isto não se sabe se o
   `wp_mail()` está partido ou se o SMTP expirou.
3. **Não caiu no spam:** avaliação de SPF, DKIM, DMARC e cabeçalhos de
   autenticação do email recebido. Um formulário que "funciona" mas entrega no
   spam é um funil de leads morto que ninguém repara durante meses.

### Higiene operacional
Frequência diária com hora fixa; submissões marcadas de forma inequívoca para
o cliente poder filtrar no CRM; opção de endpoint de teste dedicado para
clientes que não queiram entradas de teste na base de dados; possibilidade de
desativar por formulário.

---

## 5. Disponibilidade e performance

- uptime multi-região com confirmação por segunda probe antes de declarar
  downtime (elimina o falso positivo de rede)
- validação de conteúdo esperado, não só de HTTP 200 — um site hackeado
  responde 200 lindamente
- tempo de resposta e evolução histórica
- Core Web Vitals via Lighthouse ou PageSpeed Insights API, com histórico
- páginas com erro 5xx detetadas durante o crawl

---

## 6. Manutenção ativa — requer conector

O que transforma monitorização em manutenção, e é aqui que a margem existe:

- inventário e updates disponíveis, com severidade das vulnerabilidades que
  cada update fecha
- update com rede de segurança: backup, clone para staging, aplicar, comparar
  visualmente antes/depois (regressão visual por screenshot diff), smoke test
  das páginas-chave e do checkout, rollback automático se falhar
- backups verificados — um backup que nunca foi restaurado não é um backup
- histórico de intervenções, que alimenta diretamente o relatório mensal

---

## 7. Relatório mensal

Geração automática no início do mês, referente ao mês anterior, em PDF
white-label com o sistema visual Jelly (ou do cliente, nos planos superiores):

- resumo executivo em linguagem de negócio, não de sysadmin
- uptime do período e cumprimento de SLA
- incidentes: o que aconteceu, quanto tempo durou, o que foi feito
- ameaças bloqueadas e vulnerabilidades corrigidas
- updates aplicados
- estado dos formulários: submissões de teste, taxa de sucesso, latência média
- links quebrados detetados e corrigidos
- evolução de performance e Core Web Vitals
- recomendações para o mês seguinte — é isto que sustenta upsell

Envio agendado por email aos destinatários configurados, com o PDF anexado e
link para a versão interativa no portal.
