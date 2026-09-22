# Operação

O que fazer quando a plataforma para, e o que a impede de parar em silêncio.

Escrito depois de uma paragem de dezoito horas que ninguém deu por.

---

## O que aconteceu, para não voltar a acontecer

A 21 de setembro de 2026, às 22:42, o Redis do Upstash esgotou a quota do
plano gratuito — 500.000 comandos por mês — e passou a recusar **todos** os
comandos com `ERR max requests limit exceeded`.

A fila do BullMQ vive inteiramente no Redis. Sem Redis não há como enfileirar
trabalho, por isso nenhuma verificação correu durante as dezoito horas
seguintes. O Postgres continuou saudável, o worker continuou vivo, o dashboard
continuou a servir páginas, e o painel continuou verde a mostrar os números da
véspera como se fossem de hoje.

Foi descoberto por acaso, no dia seguinte, a investigar outra coisa.

Três coisas correram mal, e só a primeira é do fornecedor:

1. **A quota era insuficiente e isso era calculável.** O `uptime` corre de 5
   em 5 minutos em cada site. Com quatro sites são 1.152 jobs por dia só desse
   check, e cada job custa uma dezena de comandos ao BullMQ. Dá perto de 780
   mil por mês. O plano gratuito nunca ia chegar, e nada avisava.

2. **Um erro parava tudo.** O agendador enfileirava todos os checks vencidos
   num ciclo e só gravava as datas seguintes no fim. Um `add` que rebentasse
   matava a passagem antes dessa gravação, e nenhum check ficava adiado.
   Corrigido: cada um entra na fila por sua conta.

3. **Não havia alarme.** A mensagem existia — exata, com o número e o link da
   documentação — catorze mil vezes por minuto durante dezoito horas. Não
   faltou informação. Faltou um caminho que a levasse a uma pessoa.

---

## O sinal de vida

O agendador grava uma batida em `scheduler_heartbeats` a cada passagem, tenha
ela enfileirado alguma coisa ou não. É essa a distinção que importa: um
agendador vivo numa noite sem nada vencido não enfileira nada e está bem; um
agendador morto também não, e não está.

A batida vive no **Postgres**, não no Redis. Um sinal de vida guardado na
coisa que pode falhar não é sinal de vida nenhum.

Quatro estados:

| Estado | O que significa |
|---|---|
| `ok` | Passou há menos de 5 minutos, sem erro, e as verificações concluem. |
| `checks_late` | O agendador está bom, mas há verificações que não concluem. |
| `failing` | Continua a passar, mas a última passagem falhou. |
| `stale` | Não há passagem há mais de 5 minutos. |

O `failing` existe por causa desta avaria em concreto: o ciclo esteve vivo as
dezoito horas todas. Um sinal de vida que só perguntasse «passou?» teria
respondido «sim» o tempo inteiro.

O `checks_late` cobre a falha seguinte, que esta avaria não chegou a mostrar:
um worker que enfileira alegremente e falha todos os jobs. O agendador passaria
no primeiro sinal sem tocar no segundo.

### Vivacidade por tipo de verificação

Derivada de `check_runs`, sem tabela nova: um segundo sítio a gravar estado é
mais uma coisa que pode parar em silêncio, e o remédio não pode ter a doença.

Um par site/verificação está **atrasado** quando não tem um sucesso há mais de
`intervalo × 2 + 10 minutos`. Um check de 5 em 5 minutos tem 20 minutos de
folga — chega para um deploy ou uma rajada de recuperação, não chega para uma
avaria passar a noite.

Duas regras que evitam alarmes falsos:

- **Só conta o que já teve sucesso alguma vez.** Um tipo novo — o `page_speed`
  esteve assim um dia inteiro — é configuração por fazer, não avaria. Sem esta
  regra, cada verificação acrescentada tocava o alarme no dia em que nascesse.
- **Conta sucessos, não execuções.** Um check que corre e falha sempre está tão
  partido como um que não corre.

Sites pausados e arquivados ficam de fora: não correm nada por decisão nossa, e
marcá-los era inventar uma avaria.

O painel mostra só os sites do utilizador; o endpoint olha para a plataforma
inteira, que é o que o vigia externo precisa de saber.

### Onde se lê

- **`GET /api/health/scheduler`** — público, sem sessão. Devolve 200 quando
  está `ok` e 503 em tudo o resto, para um vigia poder decidir sem ler JSON.
- **O painel da equipa** — faixa vermelha no topo, com a mensagem de erro
  exata. Não se pode fechar, e a frase «nenhum com problemas abertos»
  desaparece enquanto a monitorização estiver parada.
- **`.github/workflows/vigia.yml`** — de 10 em 10 minutos, chama o endpoint e
  falha se não vier 200. Corre no GitHub: fora do Fly, fora do Redis, fora do
  worker. Um alarme que vive dentro da coisa que vigia cala-se com ela.

**O vigia só serve se alguém receber o email.** Confirmar em *Settings →
Notifications* do GitHub que as falhas de workflows estão ativas.

---

## Consumo do Redis

Ordem de grandeza, para dimensionar o plano antes de ele estourar:

```
comandos/mês ≈ sites × (43.200 / intervalo_uptime_min) × custo_por_job
             + sondagem do worker
```

Com `custo_por_job ≈ 10` e o `uptime` de 5 em 5 minutos, **cada site custa
cerca de 86 mil comandos por mês** só em disponibilidade. Quatro sites
aproximam-se dos 350 mil; com o resto dos checks e a sondagem, dos 780 mil.

Daqui sai a regra prática: **o plano gratuito do Upstash dá para um site.**
A partir do segundo é preciso plano pago.

A sondagem já está afinada em `queues.ts` — espera de 60 segundos em vez dos 5
por omissão, e procura de jobs abandonados de 5 em 5 minutos em vez de 30
segundos. Não é aí que está o custo; está no volume de jobs.

---

## Quando o alarme tocar

1. **`GET /api/health/scheduler`** — o `lastError` diz quase sempre o que é.
2. **Registos do worker**: painel do Fly → `jellycare-worker` → *Monitoring*.
   Os erros de infraestrutura estão estrangulados (ver `log-throttle.ts`), por
   isso a mesma mensagem aparece uma vez por minuto com a contagem das que
   foram caladas, e não catorze mil vezes.
3. **Estado das máquinas**: mesma app → *Machines*. Uma máquina `stopped` ou
   eventos de saída recentes apontam para outra coisa.

Confirmar que voltou:

```sql
select check_type, max(started_at) as ultimo_run, count(*) as runs
from check_runs
where started_at > now() - interval '30 minutes'
group by check_type
order by ultimo_run desc;
```

Depois de uma paragem longa, haverá uma rajada: todos os checks vencidos ficam
prontos ao mesmo tempo. O agendador leva cem por passagem e espalha-os por
trinta segundos. É esperado.

**Cuidado com os findings dessa rajada.** Um check que corre pela primeira vez
em muitas horas pode reportar algo que já lá estava na véspera. Verificar antes
de alarmar o cliente.
