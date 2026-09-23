# Desenho

O sistema visual da aplicação. Quem acrescentar um ecrã não tem de o
inventar outra vez, e quem o ler percebe porque é que as decisões são
estas.

## Os três princípios

**O vermelho da Jelly é identidade, não estado.** Aparece no wordmark, no
marcador do item ativo da navegação e no foco dos campos da entrada. Em mais
lado nenhum. Num produto de monitorização o vermelho pertence ao alarme: se
a marca também for vermelha, ninguém sabe se está a olhar para a marca ou
para uma avaria. É por isso que a ação principal dentro da aplicação é
grafite (`bg-ink-900`) e não vermelha — a única exceção é o botão da entrada,
onde a marca é o assunto e não há estado nenhum no ecrã.

**A moldura é escura, o conteúdo é claro.** A barra lateral separa-se do
conteúdo pela cor e não por uma linha, e dá um sítio permanente ao estado do
vigia. Durante a paragem de dezoito horas a única leitura disponível era
«não vi nenhum aviso», que não é a mesma coisa que «vi que está a vigiar».

No telemóvel a navegação fica **no fundo do ecrã** e não no topo. Um menu em
cima obriga a mão a subir o telemóvel inteiro a cada mudança de secção, e num
painel que se consulta de pé isso é a diferença entre olhar e não olhar. A
barra respeita a área segura do aparelho e o conteúdo leva espaço em baixo
para o último cartão não ficar por trás dela.

**Os cartões têm sombra, não moldura.** Uma linha de 1px à volta de cada
cartão desenha uma grelha que compete com o conteúdo. `shadow-card` para os
cartões correntes, `shadow-raised` para os que são o assunto da página.

## Tokens

Todos em `apps/web/src/app/globals.css`, dentro de `@theme`.

| Grupo | Token | Uso |
| --- | --- | --- |
| Moldura | `shell`, `shell-raised`, `shell-line`, `shell-text`, `shell-muted` | Barra lateral e barras escuras. O texto sobre escuro usa `shell-text` ou `shell-muted` — `ink-400` sobre `ink-900` fica abaixo de 4,5:1. |
| Neutros | `ink-50` (papel), `ink-100`, `ink-200`, `ink-400`, `ink-600`, `ink-900` | Fundo, separadores, texto secundário e texto principal. |
| Identidade | `jelly-500/600/700` | Ver o primeiro princípio. |
| Estado | `saudavel`, `aviso`, `alarme` | Pontos e faixas. |
| Juízo | `bom`, `medio`, `mau` | Texto de um número que está bem, assim-assim ou mal. |
| Sombra | `shadow-card`, `shadow-raised` | Elevação dos cartões. |

As severidades vivem nas classes `.sev-critical` … `.sev-ok`, cada uma com
fundo, cor de texto e o seu ponto cheio em `--sev-ponto`. A pastilha usa
`sev-<nivel>` no invólucro e `sev-ponto` no ponto: o texto tem de ser escuro
para se ler, e um texto escuro sozinho não se distingue de relance numa lista
de vinte linhas.

As cores dos gráficos estão em `lib/chart-colors.ts`, em hexadecimal porque
entram em atributos de SVG. Passaram o validador de paletas: ΔE 9,0 no pior
par em protanopia, 18,2 em visão normal, e as três acima de 3:1 contra o
branco. Mudá-las obriga a repetir essa verificação.

## Tipografia

Três famílias, servidas por nós a partir de `public/fonts` e não pelo Google:
a compilação da imagem não passa a depender de um servidor externo, e nenhum
pedido do painel de um cliente sai para um terceiro só para desenhar texto.

- **Space Grotesk** (`font-display`) — títulos de página e números em
  destaque.
- **IBM Plex Sans** (`font-sans`) — texto e interface. É o tipo por omissão.
- **IBM Plex Mono** (`font-mono`) — medições, datas, rótulos em versaletes e
  tudo o que tenha de alinhar em coluna.

Números que se comparam levam `tabular-nums`. Números com casas decimais
passam por `formatNumero`, que escreve vírgula: `toFixed` devolve sempre
ponto, e num painel português `1.8 s` lê-se como mil e oitocentos.

## Peças

Em `apps/web/src/components`:

- `shell.tsx` — a moldura e a coluna de navegação, para os dois lados: o
  painel interno e o portal do cliente. As ligações chegam prontas de quem a
  usa — as duas vistas têm raízes diferentes (`/` e `/portal`) e secções
  diferentes. A coluna muda com a rota, lida no cliente: a moldura está acima
  do ramo do site na árvore e não recebe os seus parâmetros.

  A pastilha do vigia é opcional e o portal não a leva. Um agendador parado é
  falha nossa, não do site do cliente — a mesma regra que já esconde a faixa
  de aviso e a cobertura reduzida.
- `rail.tsx` — as peças da coluna: `RailList`, `RailLink`, `RailGrupo`,
  `RailContagem`.
- `ui.tsx` — `Card`, `CardHeader`, `Stat`, `SeverityBadge`, `HealthBadge`,
  `Rotulo`, `EmptyState` e os formatadores.
- `icons.tsx` — o conjunto de ícones, traçado a 16px. Os nomes são os `slug`
  das secções, para não haver uma segunda tabela de correspondência. Nenhum
  é um emoji: um emoji muda de desenho conforme o sistema de quem lê.

## Regras que não se negoceiam

- Alvos de toque com pelo menos 44px de altura, e a navegação do telemóvel
  ao alcance do polegar.
- Texto a 4,5:1 de contraste (3:1 acima de 24px). O `ink-400` só sobre claro.
- Um `<button>`, um `<a href>` ou um `<input>` a sério — nunca um `div` com
  `onClick`, que o teclado salta.
- Nada de emoji como ícone.
