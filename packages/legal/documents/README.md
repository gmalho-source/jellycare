# Documentos legais

O texto que os clientes leem e aceitam. Cada ficheiro aqui é publicado tal e
qual: **o que estiver escrito num destes ficheiros aparece na página pública
e no comprovativo do cliente.** Notas para quem mantém o repositório vivem
neste README, nunca dentro dos documentos — uma nota interna impressa dentro
de um contrato é, na melhor das hipóteses, pouco sério.

## Como publicar uma alteração

1. Alterar o ficheiro.
2. **Subir o `version` em `../src/registry.ts`.** Uma versão publicada é
   imutável: a sincronização recusa-se a arrancar se o conteúdo mudar sem a
   versão mudar, porque reescrever uma linha da `legal_documents` apagaria o
   texto que um cliente aceitou.
3. Fazer deploy. O worker sincroniza no arranque.

Um DPA em versão nova exige nova aceitação a todos os clientes. Uma correção
de gralha não justifica isso — junte-a à próxima alteração material.

## Acrescentar um subcontratante

Subir a versão de `subprocessors.*.md` **e** escrever `effectiveAt` no
registo com uma data a 30 dias. A lista nova fica visível como pré-aviso, a
antiga continua em vigor até lá, e o cliente vê a contagem e o botão de
oposição no portal. É a Cláusula 7.ª a funcionar sozinha.

## Histórico

- **v1** — primeira publicação.
- **v2** — cláusulas 4.ª-A (operações de manutenção) e 4.ª-B (problemas que
  não podemos resolver). A plataforma deixou de só observar: aplica
  atualizações dentro da janela de manutenção. A cláusula 4.ª dizia que a
  recolha era passiva, e deixou de ser verdade — mudar o corpo do acordo
  obriga a nova aceitação por todos os clientes, e é isso que a subida de
  versão dispara.

  As condições escritas na 4.ª-A não são promessas de intenção: cada uma
  corresponde a uma trava no código, com teste que prova que trava
  (`apps/worker/src/wp-update-jobs.ts`). Se uma delas for relaxada no código,
  esta cláusula passa a estar errada.

## Por fazer

- Confirmar, no acordo de cada fornecedor, a entidade contratante, a região
  de tratamento e o mecanismo de transferência. Estão marcados
  `[a confirmar]` no Anexo III. Um anexo com a localização errada é pior do
  que um anexo incompleto.
- Validação por advogado antes da primeira assinatura.
- `terms` está no enum e não tem documento: os Termos & Condições regulam o
  negócio — preço, prazos, SLA, rescisão — e essas são decisões da Jelly. O
  mecanismo já os suporta; falta o texto.

## A versão inglesa

É o mesmo acordo assente no RGPD. Serve clientes da UE e clientes dos EAU com
nexo europeu. Para um cliente dos EAU sem esse nexo aplica-se o Decreto-Lei
Federal 45/2021, ou o regime do DIFC ou do ADGM conforme a zona, e as
cláusulas de autoridade de controlo, transferências e lei aplicável têm de
ser refeitas. Não é tradução, é outro contrato.
