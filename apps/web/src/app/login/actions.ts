'use server'

import { isIP } from 'node:net'
import { montarEmailJelly } from '@jellycare/core'
import { createLoginToken } from '@jellycare/db'
import { headers } from 'next/headers'
import { after } from 'next/server'
import { z } from 'zod'
import { appOrigin } from '@/lib/app-url'
import { getDb } from '@/lib/db'
import { loginAttemptLimited } from '@/lib/login-rate'

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

  const cabecalhos = await headers()
  // Só o endereço que o Fly põe. O `x-forwarded-for` é o primeiro valor que o
  // cliente quiser enviar, e servia tanto para contornar o limite como para
  // o esgotar na conta de outra pessoa.
  const ip = cabecalhos.get('fly-client-ip')?.trim() ?? ''
  if (loginAttemptLimited(parsed.data, isIP(ip) ? ip : null)) return resposta

  let origin: string
  try {
    origin = appOrigin(cabecalhos)
  } catch {
    return { error: 'A entrada está indisponível. Tente mais tarde.' }
  }

  const created = await createLoginToken(getDb(), parsed.data)
  if (!created) return resposta

  const link = `${origin}/auth/callback?token=${encodeURIComponent(created.token)}`

  // O envio fica para depois da resposta. Esperá-lo só quando o email existe
  // media o tempo e dizia a quem perguntasse se a conta está cá.
  after(() => sendLoginEmail(parsed.data, link))
  return resposta
}

async function sendLoginEmail(to: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    // Em desenvolvimento não há serviço de email configurado. Escrever a
    // ligação na consola do servidor é preferível a falhar em silêncio. Em
    // produção a ligação é uma chave de entrada: a consola fica com o aviso
    // de que a chave falta, e não com a chave.
    if (process.env.NODE_ENV === 'production') {
      console.error('[jellycare] RESEND_API_KEY não está definido; a ligação de entrada não foi enviada.')
      return
    }
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
      html: montarEmailJelly({
        titulo: 'A sua ligação de entrada na Jellycare',
        origem: new URL(link).origin,
        marca: 'jellycare',
        eyebrow: 'Ligação de entrada',
        paragrafos: ['Use o botão abaixo para entrar na Jellycare. É válido durante 15 minutos e só pode ser usado uma vez.'],
        botao: { texto: 'Entrar na Jellycare', url: link },
        rodape: 'Se não foi você que pediu esta ligação, ignore esta mensagem: sem ela ninguém entra.',
      }),
    }),
  })

  if (!response.ok) {
    console.error(`[jellycare] falha ao enviar a ligação de entrada: ${response.status}`)
  }
}
