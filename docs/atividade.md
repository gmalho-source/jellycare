# Registo de atividade

Tudo o que aconteceu num site e o que se fez a respeito, por ordem. Os
problemas guardam o estado em que estão; o registo guarda o caminho até lá.

Tabela `activity_events`, só de acréscimo: uma linha nunca é alterada nem
apagada, a não ser pela retenção, ao fim de 24 meses, o mesmo prazo dos
relatórios. Tipos e textos em `packages/core/src/atividade.ts`.

## O que fica registado

| Tipo | Quem escreve | Quando |
|---|---|---|
| `problema_detetado` | verificação (`recordCheckRun`) | um problema passa a aberto pela primeira vez |
| `problema_reapareceu` | verificação | um problema já resolvido volta a aparecer |
| `problema_agravou` | verificação | a gravidade sobe |
| `problema_resolvido` | verificação | o problema deixa de ser encontrado |
| `problema_reconhecido` · `problema_silenciado` · `problema_reativado` | equipa, em Problemas | ao carregar no botão |
| `claude_resolve_pedido` | equipa, botão Claude Resolve | a issue é aberta no GitHub |
| `aviso_ao_cliente` | equipa, «Avisar o cliente» | o email sai |
| `wp_atualizado` · `wp_atualizacao_falhou` | worker | a WP Umbrella confirma o resultado |

Os eventos dos problemas são escritos na mesma transação da verificação: um
problema resolvido sem linha no registo seria um buraco no histórico. As ações
da equipa são registadas depois de feitas, e uma falha no registo não as
desfaz.

Um problema `pending` (ainda por confirmar) que desaparece não deixa rasto, e
um silenciado não gera eventos, nem se agravar.

## Onde se vê

- **Separador Atividade de cada site**, no painel: tudo, com quem fez o quê.
- **Atividade**, na barra, só para a Equipa Jelly: todos os sites, com
  filtros por site, tipo e período, e os totais do período.
- **Atividade no portal do cliente**: sem o que é só da equipa
  (reconhecido, silenciado, reativado, pedidos ao Claude).
- **Relatório mensal**, secção «Atividade registada»: o detetado, voltou e
  corrigido do mês saem daqui, por isso um problema que se corrigiu, voltou e
  se corrigiu no mesmo mês conta as três vezes.

## O passado

A migração 0020 preenche o registo com o que já existia: deteções e
resoluções dos problemas, o último reconhecimento ou silenciamento, os pedidos
ao Claude Resolve, os avisos enviados e as atualizações WordPress. As
reincidências antigas e quem silenciou antes da última vez não estavam
guardados em lado nenhum e não se recuperam.

## Ainda não

O resultado do Claude Resolve do lado do GitHub (pull request aberto, merge)
entra quando o Jellycare passar a ler a issue e o pull request. Ver
`docs/claude-resolve.md`, fase 3.
