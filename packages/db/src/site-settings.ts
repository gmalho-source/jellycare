/**
 * Validação das definições editáveis de um site.
 *
 * Vive aqui e não na acção do servidor porque as regras são do domínio e não
 * do formulário: um SLA de 150% ou um destinatário sem arroba são inválidos
 * venham de onde vierem.
 */

export interface SiteSettingsInput {
  label: string
  expectedContent: string
  recipients: string
  slaTarget: string
}

export interface SiteSettings {
  label: string
  expectedContent: string | null
  reportRecipients: string[]
  slaTarget: number
}

export interface SiteSettingsResult {
  settings?: SiteSettings
  error?: string
}

/** Grosseira de propósito: quem valida emails a sério é o servidor de correio. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function parseSiteSettings(input: SiteSettingsInput): SiteSettingsResult {
  const label = input.label.trim()
  if (label.length === 0) return { error: 'O nome do site não pode ficar vazio.' }
  if (label.length > 120) return { error: 'O nome do site é demasiado longo.' }

  const recipients: string[] = []
  for (const linha of input.recipients.split(/[\n,;]/)) {
    const email = linha.trim()
    if (email.length === 0) continue
    if (!EMAIL.test(email)) return { error: `"${email}" não é um endereço de email válido.` }
    if (!recipients.includes(email)) recipients.push(email)
  }

  const sla = Number(input.slaTarget.trim().replace(',', '.'))
  if (!Number.isFinite(sla)) return { error: 'O SLA tem de ser um número.' }
  // O limite inferior não é arbitrário: abaixo de 50% o cálculo de
  // cumprimento deixa de dizer nada, e quase de certeza é um engano de quem
  // escreveu 9,9 em vez de 99,9.
  if (sla < 50 || sla > 100) return { error: 'O SLA tem de estar entre 50 e 100 por cento.' }

  const expectedContent = input.expectedContent.trim()

  return {
    settings: {
      label,
      expectedContent: expectedContent.length > 0 ? expectedContent : null,
      reportRecipients: recipients,
      // Duas casas decimais chegam: 99,95% é o mais fino que um contrato usa.
      slaTarget: Math.round(sla * 100) / 100,
    },
  }
}
