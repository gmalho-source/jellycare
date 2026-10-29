# Claude Resolve

Um botão «Claude Resolve» ao lado de certos problemas, só para a Equipa Jelly.
Leva o problema para o repositório GitHub do site, como issue, e o Claude
prepara lá a correção num pull request. Uma pessoa revê e aplica. O Jellycare
confirma na verificação seguinte e fecha o problema.

O Claude **não aplica nada em produção**: não tem credenciais do site, nem do
alojamento, nem do DNS. Prepara; alguém aprova.

## Como funciona

1. A equipa liga o site a um repositório em **Definições → Claude Resolve**
   (aceita o endereço do GitHub ou `dono/nome`). Sem repositório, o botão dá
   lugar a uma ligação para essa página.
2. Em **Problemas**, o botão aparece nos problemas abertos de um código
   elegível (ver abaixo), e só para a Equipa Jelly.
3. Ao carregar, `pedirAoClaudeAction` reserva o pedido
   (`claude_resolve_requests`, um por problema), abre a issue pela API do
   GitHub com a etiqueta `claude-resolve` e grava o número e a ligação. Se o
   GitHub falhar, a reserva é anulada e o erro aparece com a razão; uma reserva
   sem issue há mais de 5 minutos conta como abandonada.
4. A partir daí a linha mostra «Claude Resolve · issue #N», com ligação.
5. No repositório do site, o workflow `claude-resolve.yml` acorda o Claude com
   a etiqueta. As regras dele estão no `CLAUDE.md` desse repositório.

A issue leva o título e a explicação do problema, a evidência (cortada a 2000
caracteres), o procedimento a seguir (`docs/procedimentos/<família>.md`), a
ligação para o problema no painel e uma marca escondida
`<!-- jellycare:finding=ID -->` para a podermos ligar de volta mais tarde.

## Problemas elegíveis

Primeira fase: problemas frequentes, de risco baixo, que o Jellycare consegue
confirmar sozinho. Lista em `packages/core/src/claude-resolve.ts`.

- **Cabeçalhos:** `missing_hsts`, `missing_csp`, `missing_frame_protection`,
  `missing_content_type_options`, `missing_referrer_policy`,
  `http_not_redirected`, `server_version_disclosed`.
- **Email:** `spf_missing`, `spf_permissive`, `spf_duplicated`,
  `dmarc_missing`, `dmarc_policy_none`, `dmarc_partial`.
- **WordPress:** `wp_core_outdated`, `wp_updates_pending`,
  `wp_known_vulnerability`.

Um código novo só entra quando houver procedimento escrito para ele no
repositório-modelo. Um site em baixo ou um ficheiro exposto não passam pelo
botão: são incidentes, tratados por uma pessoa.

## Montar

Uma vez:

1. Criar na organização da Jelly no GitHub o repositório-modelo a partir de
   `templates/repositorio-site/` e marcá-lo como *template repository*.
2. Instalar a app do Claude na organização (https://github.com/apps/claude),
   com acesso aos repositórios `site-*`.
3. Segredo da organização `ANTHROPIC_API_KEY`, partilhado com os `site-*`.
4. Fine-grained personal access token de uma pessoa da equipa, com acesso aos
   `site-*` e só **Issues: Read and write**, nos segredos do dashboard:
   `fly secrets set GITHUB_RESOLVE_TOKEN=... -a jellycare-web`.
   A pessoa dona do token tem de ter papel **Write** nos `site-*`: o GitHub
   descarta em silêncio as etiquetas de quem não tem, e sem a etiqueta o
   workflow não acorda.

Por site: criar o repositório a partir do modelo, preencher o `site.yml` e
ligá-lo no Jellycare. Passos no `README.md` do modelo.

### Porquê um token de pessoa e não uma app

O `claude-code-action` ignora eventos abertos por bots, de propósito: impede
que um bot qualquer ponha o Claude a trabalhar. Uma issue aberta por uma
GitHub App só passava se a autorizássemos explicitamente no workflow de cada
repositório. O token de pessoa, limitado a Issues nos `site-*`, mantém a
regra simples e o estrago possível pequeno: quem o roubar abre issues, não
mexe em código nem em segredos.

## Fases

1. **Agora:** o Claude prepara, uma pessoa aplica. Sem credenciais de sites.
2. **Depois:** para correções de baixo risco (um cabeçalho, um registo DNS),
   credenciais num *environment* `producao` do GitHub com revisores
   obrigatórios: o Claude aplica só depois de uma pessoa aprovar aquela
   execução.
3. **Depois:** o Jellycare lê o estado da issue e do pull request e mostra-o na
   linha do problema, e verifica de novo assim que o pull request entra.
