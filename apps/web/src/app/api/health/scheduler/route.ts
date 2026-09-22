import { NextResponse } from 'next/server'
import { getSchedulerHealth } from '@/lib/scheduler-health'

export const dynamic = 'force-dynamic'

/**
 * O sinal de vida do agendador, para quem vigia de fora.
 *
 * Público e sem sessão, de propósito. Quem tem de fazer esta pergunta é um
 * vigia externo — um workflow agendado, um serviço de uptime — e obrigá-lo a
 * autenticar-se era pôr mais uma peça entre a avaria e o aviso. Não devolve
 * nada sobre sites nem clientes: só instantes e o erro da própria plataforma.
 *
 * Servido pelo dashboard e não pelo worker. Um sinal de vida respondido pelo
 * processo que ele vigia cala-se ao mesmo tempo que ele, e a pergunta fica
 * sem resposta exatamente quando a resposta importa.
 */
export async function GET(): Promise<NextResponse> {
  const saude = await getSchedulerHealth()

  // O código HTTP é a parte que interessa ao vigia: um workflow agendado
  // falha com um 503 e não precisa de saber ler JSON para dar o alarme.
  return NextResponse.json(
    {
      status: saude.status,
      ageSeconds: saude.ageSeconds,
      lastTickAt: saude.lastTickAt?.toISOString() ?? null,
      lastHealthyTickAt: saude.lastHealthyTickAt?.toISOString() ?? null,
      lastEnqueueAt: saude.lastEnqueueAt?.toISOString() ?? null,
      lastError: saude.lastError,
      lastErrorAt: saude.lastErrorAt?.toISOString() ?? null,
    },
    { status: saude.status === 'ok' ? 200 : 503 },
  )
}
