/**
 * Os semáforos do portal.
 *
 * A regra vive em `@jellycare/core`, partilhada com o relatório mensal: o PDF
 * e o portal têm de dar a mesma cor ao mesmo site. Este ficheiro só a expõe
 * com os nomes que o painel já usava.
 */
export { lerDesempenho, lerSeguranca, type Leitura, type Semaforo } from '@jellycare/core'
