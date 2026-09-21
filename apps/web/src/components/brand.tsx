/* eslint-disable @next/next/no-img-element */

/**
 * O wordmark Jellycare.
 *
 * Um `img` e não o `next/image`: o ficheiro é um SVG de quatro kilobytes com
 * dimensões fixas, e não há nada para o otimizador fazer que não seja pedir
 * `dangerouslyAllowSVG` em troca de nada.
 *
 * A altura é 28px por medição, não por gosto: a 20px o "care" fecha os
 * contra-formas e a 32px a marca domina uma barra que também tem de conter o
 * email e o botão de saída.
 *
 * A marca é branca e vermelha, o que obriga a barra de topo a ser escura.
 */
export function Brand() {
  return <img src="/jellycare.svg" alt="Jellycare" className="h-7 w-auto" />
}
