# O relatório mensal

Gerado pelo worker no início de cada mês, para o mês anterior, e enviado aos
destinatários do site com o PDF anexado. Configura-se por site, em
**Relatórios**, só por quem gere a organização.

## Módulos

Por esta ordem, logo a seguir ao resumo e às notas da equipa:

| Chave | Módulo |
|---|---|
| `disponibilidade` | Tempo no ar, interrupções, SLA |
| `seguranca` | Problemas em aberto e resolvidos |
| `desempenho` | Velocidade em telemóvel e computador, e a evolução no mês |
| `formularios` | Submissões de teste e entrega das notificações |
| `wordpress` | Atualizações, cópias de segurança, o que falta atualizar |
| `trabalho` | Verificações que correram |
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
