# Infraestrutura e deploy

## A decisão

| Peça | Fornecedor |
|---|---|
| Dashboard e worker | **Fly.io** |
| Postgres | **Neon** (região UE) |
| Redis | **Upstash** |
| Email de saída | **Resend** |
| Email de entrada (caixa de verificação) | **Cloudflare Email Routing** + Worker |
| DNS | **Cloudflare** |
| Reputação (opcional) | Google Safe Browsing API |

### Porquê

A escolha é decidida pelo worker, não pelo dashboard. O worker tem um ciclo de
agendamento permanente, mantém uma instância de Chromium viva entre submissões
de formulários e corre uma passagem horária de relatórios. Não é uma função que
arranca e morre, o que exclui plataformas exclusivamente serverless para essa
peça. O Fly corre containers com processos permanentes e, mais importante, faz
da segunda região de monitorização um comando em vez de uma arquitetura nova —
a corroboração entre regiões já está implementada à espera disso.

O dashboard fica no mesmo sítio para não haver duas plataformas, dois conjuntos
de variáveis e dois modelos de ligação à base de dados.

**Neon e não Supabase**: o Supabase é Postgres mais autenticação, armazenamento
e edge functions, e não usamos nenhuma das três — a autenticação é por ligação
de uso único contra as nossas tabelas, os PDF estão na base de dados, não há
edge functions. Ficaria a ser só Postgres com superfície a mais. O Neon dá
ramificação da base de dados, que torna um ambiente de testes trivial, e
suspensão automática, que faz o custo acompanhar o uso. Nada no código depende
do fornecedor: trocar é mudar a string de ligação.

**Fly e não Vercel para o dashboard**: o Vercel seria óbvio se o dashboard
fosse a aplicação toda. É a metade sem requisitos difíceis, e pô-lo lá são duas
plataformas para poupar pouco. É defensável, não é erro — o `apps/web` já não
arrasta o Playwright, por isso o build é leve e portátil.

**Hetzner com Coolify** é bastante mais barato e faz sentido quando a carteira
crescer. Agora troca dinheiro por tempo na direção errada: passa a haver um
servidor para manter e a segunda região deixa de ser um comando.

---

## O que criar, por ordem

### 1. Cloudflare: a zona de DNS

Não é um projeto nem nada ligado ao GitHub. São três coisas distintas, e só a
terceira tem código.

**a) A zona.** No painel da Cloudflare, *Add a site* → `jellycare.pt`. Isto
torna a Cloudflare o DNS do domínio; a seguir mudam-se os nameservers no
registrar para os que ela indicar. É um passo de DNS, não um deploy.

> **Escolher o plano Free.** O ecrã de onboarding mostra o Pro em destaque e o
> Free no fim da lista, fácil de passar ao lado. Nada do que a Jellycare usa
> precisa de Pro: o alojamento de DNS, o SSL e o Email Routing estão todos no
> plano gratuito. O Pro acrescenta WAF gerido e otimização de imagens, que aqui
> não servem para nada.
>
> O único gasto defensável na Cloudflare é o **Workers Paid**, cerca de 5 €/mês,
> que dá mais CPU e memória aos Workers. O nosso handler de email faz um HMAC e
> um pedido — cabe folgadamente no plano gratuito. Só vale a pena se algum dia
> começar a falhar por limite de CPU, e mesmo aí a resposta é esse plano e não
> o Pro, que é de zona e não tem relação nenhuma com os limites dos Workers.

Se `jellycare.pt` ainda não estiver registado, é preciso comprá-lo primeiro —
em qualquer registrar, ou na própria Cloudflare.

**b) O subdomínio de receção**, no passo 5.

**c) Um Worker**, também no passo 5 — o único código que vive na Cloudflare.

#### Porquê um subdomínio separado para a caixa de verificação

Não é por reputação: a caixa canária só *recebe* email, e reputação de envio
não se aplica a quem recebe. A razão é de registos DNS.

O `jellycare.pt` vai ter SPF e DKIM do Resend, para enviar os alertas e os
relatórios. A receção exige registos MX a apontar para a Cloudflare e um SPF
próprio dela. Um domínio só pode ter **um** registo SPF: dois no mesmo nome
invalidam a política inteira — é exatamente o problema que a nossa própria
plataforma deteta e reporta como `spf_duplicated`.

Pôr a receção em `check.jellycare.pt` resolve isso: a Cloudflare escreve os
registos dela no subdomínio e o apex fica livre para o Resend.

### 2. Neon

Projeto novo, região **AWS eu-central-1 (Frankfurt)**.

> **Só o Postgres database.** O ecrã de criação oferece mais quatro serviços e
> nenhum serve aqui. O *Object storage* não é preciso porque os PDF dos
> relatórios vivem na base de dados, em `bytea`: são dezenas de KB, ficam no
> mesmo backup e na mesma transação que o registo do relatório, e um bucket à
> parte só acrescentava credenciais e um segundo sítio para se perderem. As
> *Functions* não têm uso: o worker é um processo permanente no Fly, não uma
> função. O *AI gateway* não tem uso nenhum — nada no produto chama modelos. E
> o *Neon Auth* competiria com a autenticação que já existe, por ligação de uso
> único contra as tabelas `login_tokens` e `sessions`.

Guardar as duas strings de ligação que o Neon dá:

- a **pooled** (`-pooler` no host) para o dashboard
- a **direta** para o worker e para as migrações

O migrador precisa de uma ligação única para o bloqueio consultivo, por isso
não deve passar pelo pooler.

### 3. Upstash

Base de dados Redis, região UE, com **eviction desligado**. O BullMQ guarda o
estado dos jobs em Redis; com eviction ligado, o Redis pode apagar jobs a meio.

### 4. Resend

Adicionar `jellycare.pt` como domínio de envio e publicar os registos DNS que o
Resend indica (SPF, DKIM e o de retorno). Criar uma chave de API.

Convém que os dois remetentes existam e sejam distintos:
`alertas@jellycare.pt` e `relatorios@jellycare.pt`. Um relatório mensal não
interrompe ninguém e não deve partilhar reputação com o canal de incidentes.

### 5. Cloudflare Email Routing e o Worker

**Adicionar o subdomínio.** Na zona `jellycare.pt`: *Email* → *Email Routing* →
*Settings* → *Add subdomain* → `check`. A Cloudflare escreve os registos MX,
SPF, DKIM e DMARC no subdomínio, sem tocar nos do apex.

**Criar o Worker.** Localmente, `npm create cloudflare@latest` e depois
`wrangler deploy`. Pode ligar-se a um repositório do GitHub, mas não vale a
pena: são trinta linhas que não mudam.

**Ligar os dois.** Em *Email Routing* → *Routing rules*, uma regra de captura
total (*catch-all*) no subdomínio, com ação *Send to a Worker* e o Worker
acabado de criar.

O Worker assina o corpo e faz POST para o endpoint da plataforma:

```js
// Worker do Cloudflare. Segredo: CANARY_INBOX_WEBHOOK_SECRET.
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text()
    const payload = JSON.stringify({
      to: message.to,
      from: message.from,
      subject: message.headers.get('subject') ?? '',
      text: raw,
      headers: Object.fromEntries(message.headers),
    })

    const timestamp = String(Math.floor(Date.now() / 1000))
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.CANARY_INBOX_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`),
    )
    const hex = [...new Uint8Array(signature)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    await fetch('https://jellycare.pt/api/inbound-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-jellycare-timestamp': timestamp,
        'x-jellycare-signature': `sha256=${hex}`,
      },
      body: payload,
    })
  },
}
```

O segredo tem de ser o mesmo dos dois lados. O carimbo temporal entra na
assinatura e é validado com cinco minutos de tolerância — ver `docs/checks.md`.

### 6. Fly.io

Duas aplicações na organização da Jelly:

```bash
fly apps create jellycare-web
fly apps create jellycare-worker
```

Ambas em **`fra`** (Frankfurt), que é o que está nos `fly.toml`. A tentação é
pôr o dashboard em Madrid, mais perto de quem o abre em Portugal, mas essa
latência paga-se uma vez por pedido enquanto a latência até à base de dados se
paga a cada query — e uma página do dashboard faz várias. O worker vive ainda
mais agarrado ao Postgres e ao Redis. A app vai onde estão os dados; Madrid
fica para a segunda região de monitorização, no passo 8, onde a distância é a
vantagem e não o custo.

Os comandos de deploy correm a partir da raiz do repositório: o contexto de
build é o diretório atual, e o monorepo inteiro tem de lá estar.

Segredos do dashboard:

```bash
fly secrets set -a jellycare-web \
  DATABASE_URL="<neon pooled>" \
  JELLYCARE_APP_URL="https://jellycare.pt" \
  RESEND_API_KEY="<resend>" \
  ALERT_FROM_EMAIL="Jellycare <alertas@jellycare.pt>" \
  CANARY_INBOX_WEBHOOK_SECRET="<gerar: openssl rand -hex 32>"
```

Segredos do worker:

```bash
fly secrets set -a jellycare-worker \
  DATABASE_URL="<neon direta>" \
  REDIS_URL="<upstash>" \
  RESEND_API_KEY="<resend>" \
  ALERT_FROM_EMAIL="Jellycare <alertas@jellycare.pt>" \
  REPORT_FROM_EMAIL="Jellycare <relatorios@jellycare.pt>" \
  CANARY_EMAIL_DOMAIN="check.jellycare.pt" \
  GOOGLE_SAFE_BROWSING_API_KEY="<opcional>"
```

Deploy:

```bash
fly deploy -c fly/worker.toml   # primeiro: aplica as migrações
fly deploy -c fly/web.toml
fly certs add jellycare.pt -a jellycare-web
```

O `fly certs add` devolve um par de registos A e AAAA. Na Cloudflare eles ficam
com a nuvem **cinzenta**, não laranja: com o proxy ligado, a Cloudflare
intercepta o pedido de validação e o certificado do Fly nunca é emitido. Passar
pelo proxy também não traz nada — o Fly já termina o TLS e já é anycast — e
troca o IP do visitante pelo dela, o que numa plataforma de monitorização é
perder precisamente a informação que interessa.

O worker vai primeiro de propósito: é ele que corre as migrações no arranque.
O dashboard pode ter várias instâncias, e duas a migrar ao mesmo tempo é
problema à espera de acontecer.

### 7. Primeiro utilizador

A plataforma é por convite — não há registo público. Criar a organização e o
primeiro utilizador:

```bash
fly machine exec <id-da-máquina> -a jellycare-worker \
  "sh -c 'SEED_EMAIL=alguem@jelly.pt node /app/migrations-pkg/dist/seed.js'"
```

A `DATABASE_URL` já está no ambiente da máquina, por ser segredo da app. O id
da máquina vem do `fly status -a jellycare-worker`.

`fly machine exec` e não `fly ssh console`: o console abre um túnel WireGuard,
que é UDP e não passa por um proxy HTTPS. O `exec` vai pela API e funciona de
qualquer lado.

O site criado fica em estado `onboarding`, não `active`. O agendador só olha
para sites ativos, por isso nada é verificado até alguém aprovar o site no
dashboard — a semente não põe tráfego contra ninguém sem se dar por isso.

### 8. Segunda região de monitorização

Depois de o resto estar de pé:

```bash
fly scale count 2 --region fra,mad -c fly/worker.toml
```

e definir `JELLYCARE_REGION` distinto por máquina. A partir daí, uma região que
não alcance um site é confrontada com a outra antes de se declarar o site em
baixo — ver `docs/arquitetura.md`.

### 9. Fontes de reputação

O check de reputação não tem fontes por omissão: cada uma exige credenciais, e
uma fonte sem credenciais é **saltada**, não tentada — chamá-la só para receber
401 transformaria "não configurada" em "falhada" e arrastaria o check inteiro.
Sem nenhuma configurada, o check falha e diz o que falta.

**URLhaus (abuse.ch)** — gratuito, exige registo. A chave vai em
`URLHAUS_AUTH_KEY` nos segredos do worker. A autenticação passou a ser
obrigatória; sem o header a API responde 401.

**Google Safe Browsing**

— projeto no Google Cloud, ativar a Safe Browsing API, criar uma chave, e
defini-la como `GOOGLE_SAFE_BROWSING_API_KEY`. Uma chave inválida, ou a API por
ativar, dá **400** e não 401; a mensagem de erro do check inclui o que a Google
respondeu, que é onde isso vem explicado.

A chave é da plataforma e não do cliente: entra uma vez no ambiente do worker e
serve todos os sites. Não se guarda na configuração de cada check, que seria
duplicar a mesma credencial por cada linha da tabela.

---

## Ordem de grandeza do custo

Para vinte a cinquenta sites, por mês:

| | |
|---|---|
| Fly.io — dashboard + dois workers | 25–40 € |
| Neon | 0–25 € |
| Upstash Redis | 0–10 € |
| Resend | 0–20 € |
| Cloudflare | grátis |
| **Total** | **≈ 50–90 €** |

Preços mudam; isto é ordem de grandeza e não orçamento. O que não muda é a
proporção: o worker é a peça cara, porque corre sempre e precisa de memória
para o Chromium.

---

## Notas que evitam problemas

**A versão do Playwright está fixada.** A etiqueta da imagem base no
`apps/worker/Dockerfile` tem de coincidir com a versão no `package.json`. Por
isso a dependência está numa versão exata e não num intervalo: um desencontro
entre a biblioteca e os browsers da imagem dá "Executable doesn't exist" em
produção. Ao atualizar o Playwright, atualizar as duas coisas.

**O dashboard não leva Chromium.** Não gera PDF nem submete formulários — isso
é tudo do worker. O `@jellycare/forms/browser` é um subcaminho próprio
precisamente para que o barrel não arraste o Playwright para o build do
dashboard.

**O worker nunca pode adormecer.** Não tem `[http_service]` no `fly.toml`, por
isso o Fly não o suspende. Se adormecesse, parava o agendamento.

**Memória do worker.** 2 GB. O Chromium sozinho consome várias centenas de MB,
e a geração de PDF abre um contexto por relatório.

**Antes de ligar clientes reais:** DPA assinado com cada um, e a política de
retenção de `docs/riscos.md` implementada como tarefa de limpeza — ainda não
está. A verificação de propriedade do domínio já é obrigatória no código.

## Estado das imagens

As duas imagens já foram construídas no builder remoto do Fly:

| | |
|---|---|
| `jellycare-worker` | 2,6 GB — o Chromium é quase tudo |
| `jellycare-web` | 290 MB — sem Chromium, como se pretendia |

A primeira construção revelou três problemas, todos corrigidos e todos
invisíveis fora de um build a sério:

- o `pnpm deploy` do worker precisa de `--legacy` a partir do pnpm 10
- `apps/web/public` não existia e o `Dockerfile` copiava-a
- a string de ligação do Neon traz `channel_binding=require`, que o
  `postgres.js` reencaminha para o servidor como parâmetro de arranque; o
  Postgres recusa a ligação com `unrecognized configuration parameter`. A
  limpeza passou a ser feita em `packages/db/src/connection-url.ts`, por isso
  a string da consola pode ser copiada tal como vem

O que continua por verificar é o que só se vê com as máquinas a correr: o
arranque do worker, a aplicação das migrações contra o Neon, e o primeiro
relatório gerado em produção.

### Nota sobre o builder

O Fly usa por omissão o Depot. Em ambientes atrás de um proxy que corte
ligações longas, o `flyctl` fica preso em *Waiting for depot builder* e acaba
por desistir; nesse caso, `--depot=false` usa o builder clássico e funciona.
Numa máquina normal não é preciso.
