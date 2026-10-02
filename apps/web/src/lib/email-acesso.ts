import { appOrigin } from './app-url'

/*
 * O aviso de acesso, por email.
 *
 * Não leva ligação de entrada: essa é válida quinze minutos e só pode ser
 * usada uma vez, o que faz dela uma péssima coisa para pôr num convite que
 * pode ser aberto no dia seguinte. A mensagem diz que o acesso existe e manda
 * a pessoa pedir a sua própria ligação.
 */

const ROLE_DESCRIPTION: Record<string, string> = {
  admin: 'gestão completa da conta',
  staff: 'Equipa Jelly, com acesso a todos os clientes',
  member: 'acesso de equipa ao painel',
  client: 'acesso ao portal, só de leitura',
}

export async function sendAccessEmail(to: string, role: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const destino = role === 'client' ? `${appOrigin()}/portal` : appOrigin()

  const texto =
    'A Jelly deu-lhe acesso à Jellycare, onde acompanhamos a saúde dos sites que mantemos ' +
    `(${ROLE_DESCRIPTION[role] ?? 'acesso'}).\n\n` +
    `Para entrar, vá a ${appOrigin()}/login e indique este endereço de email. Receberá uma ` +
    'ligação de entrada válida durante quinze minutos. Não há palavra-passe para memorizar ' +
    'nem para perder.\n\n' +
    `Depois de entrar, encontra tudo em ${destino}.`

  if (!apiKey) {
    console.info(`[jellycare] aviso de acesso para ${to}: ${destino}`)
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: process.env.ALERT_FROM_EMAIL ?? 'Jellycare <alertas@jellycare.pt>',
      to: [to],
      subject: 'Tem acesso à Jellycare',
      text: texto,
    }),
  })

  if (!response.ok) {
    console.error(`[jellycare] falha ao avisar ${to} do acesso: ${response.status}`)
  }
}
