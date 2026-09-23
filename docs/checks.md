# Catálogo de verificações

Para cada verificação: o que faz, como é feita tecnicamente, e se precisa de
acesso interno ao site.

---

## 1. Malware e reputação

### 1.1 Blacklists e reputação de domínio — agentless
Consulta diária ao URLhaus (abuse.ch). Por aqui hão de vir também PhishTank,
Spamhaus DBL e VirusTotal URL report. A Google Safe Browsing esteve aqui e foi
retirada: a API v4 é «for non-commercial use only» e o Jellycare é vendido — a
alternativa com licença comercial é a Web Risk, paga por consulta.
Se o domínio ou qualquer URL do site
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

### 2.1b Inventário exato em WordPress — pela WP Umbrella

**Implementado.** Para sites WordPress geridos pela Jelly, o inventário não é
adivinhado por fingerprint: é lido da API pública da WP Umbrella, que já tem o
plugin instalado nesses sites.

Porque é que não escrevemos um plugin nosso: pô-lo-ia a correr com um segredo
nosso dentro do WordPress de todos os clientes. Isso é uma posição de supply
chain — se o nosso cofre vazar ou o plugin tiver um bug, o vector somos nós, em
todos os sites ao mesmo tempo. Não é preciso ocupá-la para entregar o que o
cliente quer saber, e a WP Umbrella já a ocupa, já mantém o plugin e já
responde por ele.

O que lemos, diariamente:

- plugins e temas com versão instalada e versão disponível
- vulnerabilidades conhecidas, da base de dados da Patchstack, com CVSS,
  versão afetada, versão que corrige e referência

Dois tipos de finding, de propósito diferentes:

- **um por vulnerabilidade**, com a severidade derivada do CVSS nas faixas
  oficiais do v3 (9.0+ crítico, 7.0–8.9 elevado, 4.0–6.9 médio). Uma a uma,
  porque um crítico não pode desaparecer dentro de uma contagem. A versão
  instalada entra no fingerprint: atualizar para uma versão que continua
  vulnerável é um problema novo, não o mesmo a persistir.
- **um agregado** para "N atualizações por aplicar", severidade média. Estar
  desatualizado é dívida, não incidente, e vinte alertas de update ensinam o
  cliente a ignorar alertas.

A ligação site → projeto é manual, escolhida de uma lista que mostra o
endereço de cada projeto. Não é emparelhada por hostname: ligar ao projeto
errado faz-nos reportar a um cliente as vulnerabilidades de outro, e um
endereço parecido chega para isso.

O token é da conta da Jelly, um só, e vive nos segredos das duas apps como as
outras chaves de API. A tabela `connectors` guarda o mapeamento e o estado da
última recolha, não credenciais.

**O que isto acrescenta ao RGPD:** a WP Umbrella e a Patchstack passam a ser
subprocessadores e têm de ser nomeados no DPA de cada cliente WordPress.

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

## Prova de propriedade

Nenhuma verificação de segurança corre contra um domínio cuja propriedade não
foi provada. A prova aceita-se por registo TXT em `_jellycare.<domínio>` ou
por ficheiro em `/.well-known/`, com o mesmo token — muda só onde é publicado,
e a verificação tenta as duas sem ninguém ter de escolher.

**Um site por verificar é monitorizado em disponibilidade, e só nisso.**
Observar que um URL público responde não é diferente do que faz qualquer
visitante. O agendador enfileira, para esses sites, apenas os checks marcados
como `public` no registo — enfileirar os outros seria encher a fila de
trabalho que o runner recusaria de certeza, e num site que ficasse meses por
verificar isso repetia-se a cada ciclo.

A verificação corre de hora a hora no worker, além do botão no painel. Não
corria: durante meses o painel prometeu-o e o único caminho era o botão, o que
deixava à espera para sempre quem publicasse o registo e fechasse a janela.

## Cobertura reduzida

Um check pode ter sucesso com menos cobertura do que devia: uma fonte de
reputação que não respondeu, um orçamento de rastreio esgotado antes do fim do
site. Isso não é um problema do cliente — não lhe diz respeito e não o pode
resolver — mas também não pode desaparecer, senão a plataforma degrada-se em
silêncio e continua a dizer que está tudo bem.

A execução guarda esses avisos em `check_runs.warnings`, separados do `error`
de propósito: um run com avisos teve **sucesso**, e confundi-los faria a
reconciliação tratá-lo como falhado e deixar de resolver problemas que já não
existem.

Os avisos aparecem no painel interno, na linha da execução, e no log do
worker. Nunca no portal do cliente nem no relatório mensal — há um teste de
ponta a ponta que o garante nos dois sentidos: visível à equipa, invisível ao
cliente.

Foi assim que se fechou um buraco real: com o URLhaus a responder e a Safe
Browsing a devolver 400, o check dizia `ok` e metade da cobertura desaparecia
sem ninguém dar por isso — exatamente o padrão que esta plataforma existe para
combater.

## 4. Formulários e entrega de email

A verificação mais valiosa e a que o mercado não faz bem.

### Onde se testa: declarado, não adivinhado

**O administrador declara até três páginas por site. Só os formulários que
vivem nessas páginas são preenchidos e submetidos. Sem nenhuma página
declarada, o teste de formulários não corre.**

Não foi sempre assim, e a mudança vem de duas falhas opostas do mesmo erro —
deixar a heurística decidir onde é que escrevemos no site de um cliente:

1. Submetia-se um formulário que não devia ser submetido. A classificação
   acerta quase sempre, e "quase sempre" não chega quando o custo de errar é
   um pedido falso a entrar no CRM de um cliente.
2. Não se testava um formulário real. Um formulário montado por JavaScript,
   dentro de um iframe, ou numa página que o orçamento de rastreio não
   alcança, era invisível — e o cliente ficava a pagar por uma vigilância que
   não existia, sem nada que o dissesse.

Declarar **restringe** onde mexemos; não autoriza mexer em tudo. Um formulário
de entrada, registo, compra ou pagamento continua a nunca ser submetido, esteja
ou não numa página declarada.

Uma página declarada é uma afirmação — "aqui há um formulário para testar" — e
quando não se confirma, dizemo-lo:

| Situação | Resultado |
|---|---|
| Página analisada, formulário encontrado | testado |
| Página analisada, nenhum formulário | finding `declared_form_page_empty` |
| Página pedida, sem HTML utilizável | finding `declared_form_page_unreachable` |
| Página nunca pedida (orçamento, robots.txt) | aviso de cobertura, não é finding |

A última linha é deliberada: uma limitação nossa não se disfarça de problema
do cliente.

### Descoberta
Durante o crawl, identificação de `<form>` com campos de contacto, e deteção
de formulários renderizados por JavaScript (Contact Form 7, WPForms, Gravity
Forms, Typeform embebido, HubSpot, componentes React).

O crawl continua a inventariar o site inteiro e o inventário aparece no
painel — mas deixou de mandar no que se testa. Serve para o administrador
saber o que há para declarar, e as páginas declaradas entram como sementes,
visitadas antes de tudo o resto para que nenhum orçamento as deixe de fora.

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

Os níveis 2 e 3 não são observáveis em todos os formulários, e isso não é uma
falha do formulário.

O endereço canário é o de **quem submete**. Só recebe alguma coisa se o
formulário enviar resposta automática a quem o preencheu — e a maioria não
envia: notifica o dono do site e mais nada. Nesses casos a Jellycare garante o
nível 1 e diz que os outros dois não são verificáveis, em vez de os dar por
falhados. Reportar "não gerou notificação" num formulário saudável faria
disparar o alerta mais alarmante do produto em quase todos os clientes no
primeiro dia, que é a forma mais rápida de ensinar alguém a ignorar alertas.

Para passar a verificar a entrega há dois caminhos, ambos do lado do cliente:
o formulário enviar cópia para o endereço de verificação do site, ou as
notificações serem reencaminhadas para lá.

A distinção fica no código: `form_delivery_unverified`, severidade baixa,
enquanto nunca chegou nada; `form_email_not_delivered`, severidade alta, quando
o formulário **já entregou antes** e desta vez não entregou. O segundo é um
incidente verdadeiro; o primeiro é um passo de configuração por fazer.

### Como a caixa de verificação está ligada

O endpoint `POST /api/inbound-email` recebe as mensagens que chegam ao domínio
canário. Configuração do lado do fornecedor de inbox: uma rota que reencaminhe
tudo o que chega a `CANARY_EMAIL_DOMAIN` para esse endpoint.

A assinatura é obrigatória — o endpoint é público por natureza e escreve no
histórico que sustenta o relatório do cliente. Sem verificação, qualquer pessoa
poderia declarar que as notificações de um site funcionam quando não funcionam.
São aceites dois esquemas:

- **Próprio**, para um Cloudflare Email Worker ou qualquer reencaminhador que
  escrevamos: cabeçalhos `x-jellycare-timestamp` e `x-jellycare-signature`, com
  HMAC-SHA256 de `<timestamp>.<corpo>` usando `CANARY_INBOX_WEBHOOK_SECRET`.
- **Mailgun**, com os campos `timestamp`, `token` e `signature` do próprio
  Mailgun.

O carimbo temporal entra no cálculo e é validado contra o relógio com cinco
minutos de tolerância: sem isso, uma entrega legítima capturada uma vez poderia
ser reenviada indefinidamente para falsificar entregas futuras.

Respostas: 401 a assinatura inválida, 400 a corpo ilegível, 202 a mensagens sem
referência de teste — email humano dirigido à caixa é aceite e ignorado, porque
devolver erro faria o fornecedor insistir sem fim — e 200 quando a entrega é
associada à submissão. O registo é idempotente: os fornecedores repetem
entregas quando não recebem 2xx a tempo, e a latência que vale é a da primeira
chegada.

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
- Core Web Vitals via PageSpeed Insights, com histórico
- páginas com erro 5xx detetadas durante o crawl

### Telemóvel e computador são duas verificações

`page_speed` mede em telemóvel, `page_speed_desktop` em computador. Duas e não
uma com uma opção: a periodicidade, o histórico e o sinal de vida são todos
por tipo de verificação, e a estratégia presa ao tipo impede que uma
configuração errada ponha a verificação de computador a medir telemóvel e a
escrever o resultado no histórico do computador — dois números diferentes com
o mesmo nome.

**Só o telemóvel abre problemas.** É o que a Google usa para indexar e é de lá
que vem quem desiste antes de a página abrir. O computador é medido e
mostrado, mas não gera findings: ligá-lo faria nascer um problema novo em
todos os sites com computador lento no dia em que a verificação entrou, e uma
enxurrada de avisos no primeiro dia ensina a ignorá-los. É um booleano em
`packages/checks/src/page-speed.ts` quando quisermos mudar de ideias.

### Pedir uma medição fora de horas

A secção de desempenho tem um botão «Analisar agora», só no painel interno. O
dashboard não fala com o Redis e não vale a pena que passe a falar por isto:
o botão antecipa o `next_run_at` das duas verificações e o agendador apanha-as
na passagem seguinte, que é de trinta em trinta segundos. Como o `next_run_at`
é empurrado para a frente no momento em que o job entra na fila, carregar duas
vezes seguidas não produz duas medições.

Não está no portal do cliente de propósito: cada análise é uma chamada à conta
da Google que nós pagamos.

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
