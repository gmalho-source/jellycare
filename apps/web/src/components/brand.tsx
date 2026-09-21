/**
 * O wordmark Jellycare.
 *
 * A marca é "jelly" em branco e "care" em vermelho, o que só funciona sobre
 * fundo escuro — daí a barra de topo ser escura e não branca. Vive num
 * componente próprio porque aparece no painel interno e no portal do cliente,
 * e uma marca que diverge entre os dois é uma marca que ninguém mantém.
 */
export function Brand() {
  return (
    <span className="text-lg font-semibold tracking-tight">
      <span className="text-white">jelly</span>
      <span className="text-jelly-500">care</span>
    </span>
  )
}
