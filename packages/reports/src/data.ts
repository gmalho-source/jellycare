/**
 * O motor de dados do relatório, sem nada que precise de browser.
 *
 * O `index` reexporta também o `render` e o `pdf`, e esse último importa o
 * Playwright. Importá-lo no dashboard arrastava o Chromium para dentro do
 * build do Next — a mesma lição que o `@jellycare/forms/browser` já tinha
 * ensinado, ao contrário.
 *
 * É este o subcaminho que o painel usa para calcular as métricas de 30 dias
 * com as mesmas contas do relatório mensal. Se divergissem, o painel diria
 * uma disponibilidade e o PDF que foi para o cliente diria outra.
 */
export * from './period.js'
export * from './uptime.js'
export * from './build.js'
