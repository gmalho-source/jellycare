import type { SchedulerHealth } from '@/lib/scheduler-health'

/**
 * O aviso de que a monitorização parou.
 *
 * Só para a equipa. Um agendador parado é falha nossa, não do site do
 * cliente, e é a mesma regra que já esconde a cobertura reduzida do portal.
 *
 * Fica no topo e não se pode fechar. A avaria que motivou isto durou dezoito
 * horas e o painel manteve-se verde o tempo todo, a mostrar os números da
 * véspera como se fossem de hoje. Um painel que consegue esconder que está
 * parado é pior do que não ter painel: dá confiança a quem não devia tê-la.
 */

function duracao(segundos: number): string {
  if (segundos < 120) return `${segundos} segundos`
  const minutos = Math.round(segundos / 60)
  if (minutos < 120) return `${minutos} minutos`
  const horas = Math.round(minutos / 60)
  return horas < 48 ? `${horas} horas` : `${Math.round(horas / 24)} dias`
}

export function SchedulerBanner({ health }: { health: SchedulerHealth }) {
  if (health.status === 'ok') return null

  const titulo =
    health.status === 'stale'
      ? `A monitorização está parada há ${duracao(health.ageSeconds ?? 0)}`
      : health.status === 'failing'
        ? 'A monitorização está a falhar'
        : 'Não há sinal do agendador'

  const explicacao =
    health.status === 'stale'
      ? 'Nenhuma verificação foi agendada nesse tempo. Os números abaixo são os da última passagem e não descrevem o estado atual dos sites.'
      : health.status === 'failing'
        ? 'O agendador continua a correr, mas as últimas passagens falharam. Pode não estar a agendar nada.'
        : 'O agendador nunca registou uma passagem. Ou o worker não arrancou, ou está a arrancar e a morrer.'

  return (
    <div className="rounded-xl border border-[#a32233]/30 bg-[#a32233]/5 px-5 py-4">
      <p className="text-sm font-semibold text-[#a32233]">{titulo}</p>
      <p className="mt-1 text-sm text-ink-700">{explicacao}</p>

      {/* A mensagem exata, no painel. Da última vez ela existia — catorze mil
          vezes por minuto — e só nos registos. Quem podia agir não a via. */}
      {health.lastError && (
        <p className="mt-2 break-words rounded-lg bg-white px-3 py-2 font-mono text-xs text-ink-700">
          {health.lastError}
        </p>
      )}

      <p className="mt-2 text-xs text-ink-500">
        {health.lastHealthyTickAt
          ? `Última passagem sem erros: ${health.lastHealthyTickAt.toLocaleString('pt-PT')}.`
          : 'Nunca houve uma passagem sem erros.'}
      </p>
    </div>
  )
}
