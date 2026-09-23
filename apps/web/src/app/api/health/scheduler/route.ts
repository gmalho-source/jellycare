import { NextResponse } from 'next/server'
import { getCheckLiveness, getSchedulerHealth } from '@/lib/scheduler-health'

export const dynamic = 'force-dynamic'

/**
 * O sinal de vida da plataforma, para quem vigia de fora.
 *
 * Público e sem sessão, de propósito. Quem tem de fazer esta pergunta é um
 * vigia externo — um workflow agendado, um serviço de uptime — e obrigá-lo a
 * autenticar-se era pôr mais uma peça entre a avaria e o aviso. Não devolve
 * nada sobre sites nem clientes: só instantes, contagens e o erro da própria
 * plataforma.
 *
 * Servido pelo dashboard e não pelo worker. Um sinal de vida respondido pelo
 * processo que ele vigia cala-se ao mesmo tempo que ele, e a pergunta fica
 * sem resposta exatamente quando a resposta importa.
 *
 * Responde a **duas** perguntas, porque a primeira sozinha não chega: «o
 * agendador está a enfileirar?» e «o trabalho está a terminar?». Um worker que
 * enfileira alegremente e falha todos os jobs passava na primeira sem tocar
 * na segunda.
 */
export async function GET(): Promise<NextResponse> {
  const [agendador, checks] = await Promise.all([getSchedulerHealth(), getCheckLiveness()])

  const atrasados = checks.filter((check) => check.late > 0)

  // O estado do agendador tem precedência: se o ciclo parou, os checks
  // atrasados são consequência disso e não uma avaria à parte.
  const status =
    agendador.status !== 'ok' ? agendador.status : atrasados.length > 0 ? 'checks_late' : 'ok'

  return NextResponse.json(
    {
      status,
      // Mantido no topo por compatibilidade com quem já lê `ageSeconds`.
      ageSeconds: agendador.ageSeconds,
      lastTickAt: agendador.lastTickAt?.toISOString() ?? null,
      lastHealthyTickAt: agendador.lastHealthyTickAt?.toISOString() ?? null,
      lastEnqueueAt: agendador.lastEnqueueAt?.toISOString() ?? null,
      lastError: agendador.lastError,
      lastErrorAt: agendador.lastErrorAt?.toISOString() ?? null,
      checks: checks.map((check) => ({
        checkType: check.checkType,
        tracked: check.tracked,
        late: check.late,
        lastSuccessAt: check.lastSuccessAt?.toISOString() ?? null,
        worstLateMinutes: check.worstLateMinutes,
      })),
    },
    {
      // O código HTTP é a parte que interessa ao vigia: falha com um 503 e não
      // precisa de saber ler JSON para dar o alarme.
      status: status === 'ok' ? 200 : 503,
      // Nada disto pode ser guardado por ninguém. Sem `Cache-Control`, um
      // intermediário — a CDN de amanhã, o proxy da empresa de quem vigia —
      // pode servir um 200 de há dez minutos e o alarme fica a olhar para uma
      // fotografia. Um sinal de vida cacheado é pior do que não ter sinal:
      // responde «está tudo bem» com autoridade.
      headers: { 'cache-control': 'no-store, max-age=0' },
    },
  )
}
