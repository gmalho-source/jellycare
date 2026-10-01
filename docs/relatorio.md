# O relatório mensal

Gerado pelo worker no início de cada mês, para o mês anterior, e enviado aos
destinatários do site com o PDF anexado. Configura-se por site, em
**Relatórios**, só por quem gere a organização.

## Período

O relatório agendado cobre o mês anterior, no fuso do cliente, e sai no dia
configurado na organização (`report_send_day`, dia 3 por omissão).

**Um site que entrou a meio do mês é medido a partir do dia em que entrou.**
O cabeçalho diz «acompanhamento desde 22 de setembro de 2026», e a cobertura e
o SLA contam sobre os dias vigiados. Contados sobre o mês inteiro, nove dias
bem medidos apareciam como trinta mal medidos — cobertura de 27% e nenhum juízo
sobre o SLA.

**Um mês em que o site ainda não existia não tem relatório.** Nem o agendado
nem o pedido à mão: o PDF saía na mesma, a dizer que não houve observações, o
que é verdade e se lê como avaria. O pedido fica concluído com a razão escrita
no painel.

**«Enviar agora» escolhe o período:** o último mês completo, ou o mês em curso
até ao momento do pedido. Para um cliente novo o segundo é o único com dados,
e o painel escolhe-o por ele — desliga o outro quando não teria nada.

O do mês em curso é **provisório** (`reports.partial`). O PDF diz isso no
cabeçalho, o painel e o portal marcam-no, e quando sai o do mês completo este
toma-lhe o lugar em vez de ser impedido por ele. As notas «só no próximo» que
o provisório levou voltam à fila e seguem no definitivo.

## O que o relatório mostra

**Primeira página — está tudo bem?** Os semáforos de segurança e de desempenho,
com a mesma regra do portal (`@jellycare/core`, `lerSeguranca` e
`lerDesempenho`): o PDF e o portal têm de dar a mesma cor ao mesmo site. Até
quatro indicadores — disponibilidade, tempo de resposta, pontuação em
telemóvel e pontos em aberto ou verificações corridas —, o resumo e as notas
da equipa. O detalhe começa na página seguinte.

**O que verificámos, e não só o que falhou.** Um mês sem incidentes é o melhor
resultado possível, e um relatório que só fala de problemas mostra-o como «0,
0, 0». A lista diz, verificação a verificação, o que foi visto e o resultado:
ligação cifrada, certificado (com a data até quando é válido), autenticação
do email, DMARC, ficheiros expostos, reputação, cabeçalhos, WordPress. Só
entra o que correu com sucesso no período — um visto numa verificação que não
correu seria afirmar que olhámos. O juízo vem dos problemas em aberto no fim
do período (`packages/reports/src/detalhe.ts`).

A linha da reputação diz que fontes foram consultadas na última execução e
quantas páginas — as listas da Google que o Chrome usa para o aviso de site
perigoso (Web Risk) e o URLhaus. Só as que responderam: o check grava a fonte
como consultada apenas quando ela devolveu resposta, para o relatório nunca
afirmar que a Google viu o site num dia em que a consulta falhou.

Sem nenhuma verificação de segurança no período, o semáforo fica cinzento, e
não verde.

**Gráficos.** Disponibilidade dia a dia, com os dias anteriores à entrada no
acompanhamento juntos num bloco em vez de barras vazias; tempo de resposta
diário; as cinco categorias do Lighthouse e a evolução da pontuação no mês. SVG
escrito à mão (`graficos.ts`), sem bibliotecas: o PDF é gerado sem rede.

**Pontos em aberto** com a explicação do portal — o que é e o que fazemos — e o
que foi corrigido no mês.

**Atividade registada.** A cronologia do mês: entrada no acompanhamento,
problemas detetados e corrigidos (agrupados por dia), interrupções,
atualizações WordPress aplicadas, avisos enviados ao cliente (só os que
saíram) e a evolução da velocidade. No máximo 14 linhas; com mais, fica o
princípio e o fim e uma linha a dizer quantas ficaram de fora. Ao lado, as
verificações corridas por tipo.

**Próximos passos.** O que a Jelly vai fazer, nunca o nome técnico do
problema, sem repetir a mesma ação. Primeiro os problemas graves e médios; os
de gravidade baixa só completam a lista até três.

A linha de autoria vai no rodapé de cada página, ao lado da numeração.

## Módulos

Por esta ordem, logo a seguir ao resumo e às notas da equipa:

| Chave | Módulo |
|---|---|
| `disponibilidade` | Tempo no ar, interrupções, SLA |
| `seguranca` | O que foi verificado, pontos em aberto e corrigidos |
| `desempenho` | Velocidade em telemóvel e computador, e a evolução no mês |
| `formularios` | Submissões de teste e entrega das notificações |
| `wordpress` | Atualizações, cópias de segurança, o que falta atualizar |
| `trabalho` | Atividade registada: cronologia e verificações corridas |
| `proximos` | O que a Jelly faz a seguir |

A lista vive num sítio só, `packages/reports/src/sections.ts`. O relatório
usa-a para saber o que desenhar e o painel para mostrar o que se pode tirar.

**Por omissão entra tudo.** O site guarda os módulos que saem
(`sites.report_excluded_sections`) e não os que entram: um módulo novo aparece
logo em todos os sites, em vez de nascer desligado em cada um. Chaves que
deixem de existir são ignoradas na geração.

O resumo entra sempre e acompanha os módulos — tirar a disponibilidade tira
também a frase sobre ela no resumo, e os próximos passos deixam de sugerir
trabalho sobre um módulo que o cliente não recebe. Não se pode tirar tudo: um
relatório só com o resumo não diz nada.

O módulo WordPress só aparece com ligação à WP Umbrella, marcado ou não. O de
desempenho, sem medições no mês, diz isso mesmo em vez de desaparecer.

## Notas da equipa

Texto da equipa para o cliente, a seguir ao resumo, com o título «Nota da
equipa». Duas espécies:

- **Em todos os relatórios** — segue em cada relatório até alguém a retirar.
  Para o que é verdade enquanto for: condições do contrato, um pedido pendente
  do lado do cliente.
- **Só no próximo** — segue no relatório seguinte e mais nenhum. Para o que
  aconteceu no mês.

Pode haver várias de cada, e acrescentar uma nova nunca obriga a mexer nas que
já existem. A nova nota nasce «só no próximo» por omissão: esquecida, uma nota
persistente continuava a sair meses depois de deixar de ser verdade.

Uma nota «só no próximo» fica presa ao relatório que a levou (`report_id`).
Regenerar esse relatório apaga-o e volta a gerá-lo; com `on delete set null`,
a nota regressa à fila e entra na versão nova em vez de desaparecer.

Retirar uma nota não a apaga: fica marcada com `archived_at` e aparece em
«Notas anteriores», com o relatório em que seguiu. É o registo do que já foi
dito ao cliente. Uma nota que já seguiu não se retira — faz parte de um
relatório enviado, e retirá-la não o desenviava.

Nada disto se vê no portal do cliente. As notas do mês seguinte são trabalho
da equipa até serem enviadas.
