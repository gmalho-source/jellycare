'use server'

import { createLoginToken } from '@jellycare/db'
import { headers } from 'next/headers'
import { z } from 'zod'
import { getDb } from '@/lib/db'

export type LoginState = { message?: string; error?: string }

const emailSchema = z.string().trim().toLowerCase().email('Indique um endereço de email válido.')

/**
 * Envia a ligação de entrada.
 *
 * A resposta é a mesma para um email conhecido e para um desconhecido. Caso
 * contrário, o formulário de entrada passaria a servir para descobrir quem tem
 * conta na plataforma.
 */
export async function requestLoginLink(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Email inválido.' }

  const resposta = {
    message: 'Se este email tiver conta, enviámos uma ligação de entrada. É válida 15 minutos.',
  }

  const created = await createLoginToken(getDb(), parsed.data)
  if (!created) return resposta

  const baseUrl = process.env.JELLYCARE_APP_URL ?? `https://${(await headers()).get('host')}`
  const link = `${baseUrl}/auth/callback?token=${encodeURIComponent(created.token)}`

  await sendLoginEmail(parsed.data, link)
  return resposta
}

async function sendLoginEmail(to: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    // Em desenvolvimento não há serviço de email configurado. Escrever a
    // ligação na consola do servidor é preferível a falhar em silêncio.
    console.info(`[jellycare] ligação de entrada para ${to}: ${link}`)
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: process.env.ALERT_FROM_EMAIL ?? 'Jellycare <alertas@jellycare.pt>',
      to: [to],
      subject: 'A sua ligação de entrada na Jellycare',
      text:
        'Use a ligação abaixo para entrar na Jellycare. É válida durante 15 minutos e só pode ' +
        `ser usada uma vez.\n\n${link}\n\n` +
        'Se não foi você que a pediu, ignore esta mensagem.',
    }),
  })

  if (!response.ok) {
    console.error(`[jellycare] falha ao enviar a ligação de entrada: ${response.status}`)
  }
}
