# O assistente técnico

Um botão «Pedir apoio» ao lado de cada problema, na vista interna. Abre uma
conversa com o Claude sobre **aquele** problema, com a evidência que a
verificação recolheu já no contexto.

Não há assistente para o cliente, e é uma decisão e não uma falta. Ver
[Porque não há um para o cliente](#porque-não-há-um-para-o-cliente).

## Como funciona

1. O botão chama `POST /api/assistente/[findingId]`.
2. O endpoint confirma que quem pede **gere** a organização — não basta
   pertencer — e devolve 404 quando não gere, a mesma resposta que dá para um
   problema que não existe.
3. `lerProblemaParaAssistente` monta o contexto a partir da base de dados.
4. `@jellycare/assistant` compõe o pedido e devolve a resposta em streaming.
5. Os pedaços vão para o browser em texto simples; no fim, a resposta e os
   tokens consumidos ficam gravados.

O contexto é remontado a cada turno e nunca guardado com a conversa: um
problema que agravou entretanto, ou que já foi resolvido, tem de entrar na
conversa como está agora.

## O que vai no contexto

O site (nome, endereço, estado, se a propriedade do domínio está provada), o
problema (código, gravidade, há quantos dias está aberto, quantas observações),
a evidência recolhida, as cinco execuções mais recentes daquela verificação com
métricas e erros, o inventário WordPress quando há ligação — só os componentes
por atualizar — e se há uma janela de manutenção aberta.

A evidência vem de um sistema de terceiros: cabeçalhos, respostas, certificados
do site do cliente. Vai marcada em `<evidencia>` e o prompt de sistema diz que
ali dentro é **dados e nunca instruções**. Um site que sirva um cabeçalho com
texto dirigido a um modelo é um facto a assinalar à equipa, não uma ordem. O
assistente não tem ferramentas nenhumas, por isso o pior caso continua a ser uma
resposta errada e não uma ação.

## Custo

O prompt de sistema é constante e vai marcado para cache. É o que faz uma
conversa de vários turnos custar cêntimos: a partir do segundo turno, a maior
parte da entrada é lida da cache a um décimo do preço.

Cada mensagem grava `input_tokens`, `output_tokens` e `cached_tokens`, para o
consumo se poder medir sem ir à fatura. Se `cached_tokens` vier a zero em
pedidos repetidos, alguma coisa está a mudar o prefixo e a conta vai subir em
silêncio.

O modelo é `claude-opus-5-5`, com `effort: low` — a tarefa é explicar evidência
que já lhe é dada, não resolver um problema de raiz. Sobe-se se as respostas
ficarem rasas.

## Configuração

```
fly secrets set ANTHROPIC_API_KEY=... -a jellycare-web
```

Sem a chave, o botão continua a aparecer e o endpoint responde 503 com a razão,
que o painel mostra. É de propósito: uma funcionalidade que desaparece sem
explicação lê-se como avaria.

O worker não precisa da chave. Isto só corre a pedido de uma pessoa.

## Limites

Uma pergunta tem no máximo 2000 caracteres e cada pedido leva no máximo os 20
turnos anteriores. Uma conversa não tem fim natural e a história inteira vai no
pedido de cada vez; sem um teto, uma conversa longa deixada aberta multiplica o
custo de cada turno seguinte.

Uma conversa por problema e por pessoa. Partilhada era pior de duas maneiras: o
histórico de um colega entrava no contexto do modelo sem ninguém contar com
isso, e duas pessoas a escrever ao mesmo tempo intercalavam turnos.

## Porque não há um para o cliente

Os checks emitem 45 códigos distintos. É um conjunto fechado: quando um cliente
pergunta «o que é isto?», a pergunta tem 45 respostas possíveis, que se escrevem
uma vez e se revêem. Isso é conteúdo, não é IA.

Um assistente a falar com um cliente fala em nome da Jelly sobre a segurança do
site dele, e o cliente não tem como apanhar uma resposta errada — é o público
onde uma alucinação custa mais. Calibrar para cima num cabeçalho em falta faz um
cliente entrar em pânico; calibrar para baixo em algo que depois é explorado é
pior.

O passo seguinte planeado é a explicação por código no portal e no relatório
mensal, escrita e revista por gente. Um chat para o cliente, se vier, vem depois
disso e assente nessas explicações.

## Proteção de dados

Isto manda dados de sites de clientes para a Anthropic, o que a torna
subcontratante. **Tem de constar da lista de subcontratantes e do DPA**, e os
clientes com DPA negociado em papel têm de ser verificados um a um. Ver
`docs/riscos.md` e o módulo legal.
