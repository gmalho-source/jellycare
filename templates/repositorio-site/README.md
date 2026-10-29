# Repositório modelo de site — Jellycare

Modelo para o repositório de **um** site em manutenção pela Jelly. Cada site
com o Claude Resolve ligado tem o seu repositório, criado a partir deste.

Quando alguém da equipa carrega em **Claude Resolve** num problema do
Jellycare, o Jellycare abre aqui uma issue com a etiqueta `claude-resolve`. O
workflow `.github/workflows/claude-resolve.yml` acorda o Claude, que confirma o
problema de fora e prepara a correção num pull request. Uma pessoa revê e
aplica. O Jellycare volta a verificar e fecha o problema sozinho.

O Claude **não aplica nada em produção** e este repositório não guarda
credenciais. As regras completas estão em `CLAUDE.md`.

## Criar o repositório de um site

1. No GitHub, **Use this template → Create a new repository**, na organização
   da Jelly, **privado**, com o nome do domínio (ex.: `site-exemplo-pt`).
2. Instala a app do Claude no repositório:
   https://github.com/apps/claude (ou uma vez para a organização inteira, com
   acesso aos repositórios `site-*`).
3. Garante o segredo `ANTHROPIC_API_KEY`: de preferência um segredo da
   organização partilhado com os repositórios `site-*`, para não o repetir.
4. Preenche o `site.yml`: plataforma, alojamento, como se entra, DNS, email,
   plugins críticos e janela de manutenção. Sem segredos.
5. Em `docs/acessos.md`, as notas para quem aplica (onde estão as credenciais
   no gestor, nunca as credenciais).
6. Se o código do site existir, põe-no em `site/` e marca
   `codigo_neste_repositorio: true` no `site.yml`.
7. No Jellycare, em **Definições** do site, cartão **Claude Resolve**, cola o
   endereço do repositório.

A etiqueta `claude-resolve` é criada pelo GitHub na primeira issue, desde que
a pessoa dona do token do Jellycare tenha papel **Write** no repositório.

## O ciclo de um problema

1. Jellycare → issue com o problema, a evidência e o procedimento a seguir.
2. Claude → comentário de progresso na issue e um branch com a correção, com
   ligação para abrir o pull request.
3. Equipa → revê, pede ajustes com `@claude`, aplica com o acesso do site e
   faz merge para ficar registado.
4. Jellycare → próxima verificação confirma e fecha o problema.
