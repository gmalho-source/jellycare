import { launchBrowser, type BrowserOptions } from '@jellycare/forms/browser'
import { PDFDocument } from 'pdf-lib'
import type { Browser } from 'playwright'
import type { ReportData } from './build.js'
import { escapeHtml, renderReportHtml, rodape } from './render.js'

/**
 * Geração do PDF.
 *
 * Print-to-PDF de um browser em vez de uma biblioteca de composição: o
 * relatório é HTML e CSS, a equipa pode ajustá-lo sem aprender uma API de
 * layout, e o que se vê no browser é o que sai no PDF.
 */

export interface PdfOptions {
  /** Browser partilhado. Sem ele, arranca-se um só para este relatório. */
  browser?: Browser
  launch?: BrowserOptions
}

export async function renderReportPdf(
  data: ReportData,
  options: PdfOptions = {},
): Promise<Buffer> {
  const ownBrowser = options.browser ? null : await launchBrowser(options.launch ?? {})
  const browser = options.browser ?? ownBrowser!
  const context = await browser.newContext({ locale: 'pt-PT' })
  const page = await context.newPage()

  try {
    // `domcontentloaded` e não `networkidle`: o template não carrega nada de
    // fora, e esperar por rede que nunca vem custaria segundos por relatório.
    await page.setContent(renderReportHtml(data), { waitUntil: 'domcontentloaded' })

    const base = { format: 'A4', printBackground: true, preferCSSPageSize: true } as const
    const comRodape = {
      ...base,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:7px;color:#8b8b96;padding:0 14mm;display:flex;justify-content:space-between;">
        <span>${escapeHtml(rodape(data))}</span>
        <span><span class="pageNumber"></span>/<span class="totalPages"></span></span>
      </div>`,
    }

    if (!data.marcaJelly) return await page.pdf(comRodape)

    // A capa sai sem rodapé: o Chromium põe o rodapé em todas as páginas, e
    // por cima da fotografia lia-se mal e numerava a capa. Imprime-se a capa
    // à parte e junta-se ao resto.
    const [capa, corpo] = [
      await page.pdf({ ...base, pageRanges: '1' }),
      await page.pdf({ ...comRodape, pageRanges: '2-' }),
    ]
    const junto = await PDFDocument.create()
    for (const parte of [capa, corpo]) {
      const documento = await PDFDocument.load(parte)
      for (const pagina of await junto.copyPages(documento, documento.getPageIndices())) junto.addPage(pagina)
    }
    return Buffer.from(await junto.save())
  } finally {
    await context.close().catch(() => {})
    if (ownBrowser) await ownBrowser.close().catch(() => {})
  }
}

/** Nome de ficheiro previsível, para o anexo do email e para o arquivo. */
export function reportFileName(data: ReportData): string {
  const slug = data.site.hostname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const month = String(data.period.month).padStart(2, '0')
  return `jellycare-${slug}-${data.period.year}-${month}.pdf`
}
