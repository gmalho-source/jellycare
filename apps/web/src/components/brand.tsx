/* eslint-disable @next/next/no-img-element */

/**
 * O wordmark Jellycare.
 *
 * Um `img` e não o `next/image`: o ficheiro é um SVG de quatro kilobytes com
 * dimensões fixas, e não há nada para o otimizador fazer que não seja pedir
 * `dangerouslyAllowSVG` em troca de nada.
 *
 * A altura por omissão é 28px por medição, não por gosto: a 20px o "care"
 * fecha as contra-formas e a 32px a marca domina uma barra de topo que também
 * tem de conter o email e o botão de saída. O ecrã de entrada passa uma
 * altura maior porque ali a marca é o assunto e não um rótulo.
 *
 * A marca é branca e vermelha, o que obriga a fundo escuro onde quer que
 * apareça.
 */
export function Brand({ className = 'h-7' }: { className?: string }) {
  return <img src="/jellycare.svg" alt="Jellycare" className={`${className} w-auto`} />
}
