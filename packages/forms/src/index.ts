// `browser.js` fica de fora de propósito: é a única peça que importa o
// Playwright em runtime, e arrastá-la pelo barrel punha um browser inteiro
// dentro do build do dashboard, que não precisa dele para nada.
// Quem precisa importa '@jellycare/forms/browser'.
export * from './discovery.js'
export * from './canary.js'
export * from './mailbox.js'
export * from './submitter.js'
export * from './site-discovery.js'
export * from './registry.js'
export * from './inbound.js'
