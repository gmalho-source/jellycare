# Acessos

Como a equipa da Jelly entra neste site. **Aqui não se escreve nenhuma
credencial**: nem utilizador, nem palavra-passe, nem chave, nem URL com token.
As credenciais vivem no gestor de palavras-passe da Jelly.

## Fase 1 (agora)

O Claude **não tem acesso** ao site. Prepara a correção num pull request e uma
pessoa aplica-a, com o acesso que o `site.yml` indica em `alojamento.acesso`:

- `ssh` — a pessoa corre os comandos do pull request no servidor.
- `painel` — a pessoa segue os cliques do pull request no painel (cPanel,
  Plesk, painel do fornecedor) ou no backoffice.
- `api` — o fornecedor tem API (Cloudflare, Vercel); a pessoa aplica pela API
  ou pelo painel.
- `nenhum` — só o cliente ou o fornecedor mexe; o pull request traz o pedido
  pronto a enviar.

Notas úteis para quem aplica, **sem segredos**:

- Onde estão as credenciais no gestor (nome da entrada, não o conteúdo):
- Caminho do site no servidor:
- Particularidades (cache a limpar, CDN, regras do fornecedor):

## Fase 2 (futuro, não ativa)

Para o Claude aplicar sozinho em casos de baixo risco, as credenciais passam a
estar num *environment* do GitHub chamado `producao`, com revisores
obrigatórios: o workflow só as recebe depois de uma pessoa aprovar aquela
execução. Até lá, o workflow deste repositório não tem segredos do site.
