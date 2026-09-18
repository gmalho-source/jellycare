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

### 1. Domínios (Cloudflare)

- `jellycare.pt` — dashboard
- `check.jellycare.pt` — caixa de verificação dos formulários

O segundo é um subdomínio mas tem de ter reputação de email própria: é dele que
dependem os testes de entrega, e não convém misturá-la com a do domínio que
envia os alertas.

### 2. Neon

Projeto novo, região **AWS eu-central-1 (Frankfurt)**. Guardar as duas strings
de ligação que o Neon dá:

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

### 5. Cloudflare Email Routing

Ativar o Email Routing em `check.jellycare.pt` com uma regra de captura total
(*catch-all*) que entrega a um Worker. O Worker assina o corpo e faz POST para
o endpoint da plataforma:

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

O worker vai primeiro de propósito: é ele que corre as migrações no arranque.
O dashboard pode ter várias instâncias, e duas a migrar ao mesmo tempo é
problema à espera de acontecer.

### 7. Primeiro utilizador

A plataforma é por convite — não há registo público. Criar a organização e o
primeiro utilizador:

```bash
fly ssh console -a jellycare-worker -C \
  "node /app/migrations-pkg/dist/seed.js"
# com DATABASE_URL e SEED_EMAIL no ambiente
```

Ou, mais simples, correr a semente a partir da máquina de quem faz o deploy,
com a string de ligação do Neon.

### 8. Segunda região de monitorização

Depois de o resto estar de pé:

```bash
fly scale count 2 --region mad,ams -c fly/worker.toml
```

e definir `JELLYCARE_REGION` distinto por máquina. A partir daí, uma região que
não alcance um site é confrontada com a outra antes de se declarar o site em
baixo — ver `docs/arquitetura.md`.

### 9. Opcional: Google Safe Browsing

Projeto no Google Cloud, ativar a Safe Browsing API, criar uma chave. Sem ela o
check de reputação corre à mesma, só com o URLhaus, e a cobertura fica menor.

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

## O que ainda não foi testado

Os `Dockerfile` e os `fly.toml` deste diretório foram escritos mas **não
construídos**: o ambiente onde foram desenvolvidos não tinha daemon de Docker.
O que foi verificado sem containers:

- o migrador de produção aplica as migrações numa base de dados limpa e é
  idempotente
- a saída autónoma do Next arranca e serve, e não contém o Playwright

O primeiro `fly deploy` deve ser tratado como a primeira execução real destas
imagens.
