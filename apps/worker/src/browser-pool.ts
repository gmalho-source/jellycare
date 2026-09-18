import { launchBrowser, type BrowserOptions } from '@jellycare/forms/browser'
import type { Browser } from 'playwright'

export interface BrowserPool {
  get: () => Promise<Browser>
  close: () => Promise<void>
}

/**
 * Um browser partilhado, arrancado só quando é preciso.
 *
 * Arrancar o Chromium custa segundos e algumas centenas de MB. A maior parte
 * dos workers nunca submete um formulário, e os que submetem fazem-no em
 * rajadas — vale a pena manter a instância viva entre submissões e não pagar o
 * arranque a cada uma.
 */
export function createBrowserPool(options: BrowserOptions = {}): BrowserPool {
  let browser: Browser | null = null
  let launching: Promise<Browser> | null = null

  const launch = async (): Promise<Browser> => {
    const instance = await launchBrowser(options)
    browser = instance
    launching = null
    return instance
  }

  return {
    async get() {
      // Um browser que morreu — por falta de memória, por exemplo — não pode
      // ficar em cache a devolver erros a todas as submissões seguintes.
      if (browser && !browser.isConnected()) browser = null
      if (browser) return browser
      launching ??= launch()
      return launching
    },

    async close() {
      const instance = browser
      browser = null
      launching = null
      if (instance?.isConnected()) await instance.close().catch(() => {})
    },
  }
}
