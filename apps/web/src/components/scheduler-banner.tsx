import { Icone } from './icons'
import { duracao, type CheckLiveness, type SchedulerHealth } from '@/lib/scheduler-health'

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

function Faixa({
  tom,
  titulo,
  children,
}: {
  /** `aviso` é âmbar, `alarme` é vermelho. A cor não é decoração: separa
      «algumas verificações atrasadas» de «não está a correr nada». */
  tom: 'aviso' | 'alarme'
  titulo: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex gap-4 rounded-2xl border-l-4 bg-white px-5 py-4 shadow-card ${
        tom === 'alarme' ? 'border-alarme' : 'border-aviso'
      }`}
    >
      <span
        className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex ${
          tom === 'alarme' ? 'sev-critical' : 'sev-high'
        }`}
      >
        <Icone nome="problemas" className="h-5 w-5" />
      </span>

      <div className="min-w-0">
        <p className="text-[0.9375rem] font-semibold text-ink-900">{titulo}</p>
        {children}
      </div>
    </div>
  )
}

export function SchedulerBanner({
  health,
  checks = [],
}: {
  health: SchedulerHealth
  checks?: readonly CheckLiveness[]
}) {
  const atrasados = checks.filter((check) => check.late > 0)

  // O agendador vivo não chega. Um worker que enfileira e falha todos os jobs
  // deixava esta faixa calada enquanto a plataforma não olhava para nada.
  if (health.status === 'ok' && atrasados.length === 0) return null

  // Verificações paradas com o agendador vivo é uma avaria diferente, e a
  // faixa tem de a nomear em vez de dizer «o agendador parou», que seria falso.
  if (health.status === 'ok') {
    return (
      <Faixa
        tom="aviso"
        titulo={
          atrasados.length === 1
            ? 'Uma verificação deixou de concluir'
            : `${atrasados.length} verificações deixaram de concluir`
        }
      >
        <p className="mt-1 text-sm text-ink-600">
          O agendador está a funcionar, mas estas não terminam com sucesso há mais tempo do que
          deviam. Os números dos sites afetados não descrevem o estado atual.
        </p>
        <ul className="mt-2.5 space-y-1">
          {atrasados.map((check) => (
            <li key={check.checkType} className="text-xs text-ink-600">
              <span className="font-mono font-medium text-ink-900">{check.checkType}</span> —{' '}
              {check.late} de {check.tracked} {check.tracked === 1 ? 'site' : 'sites'}, o pior sem
              sucesso há {duracao((check.worstLateMinutes ?? 0) * 60)}
            </li>
          ))}
        </ul>
      </Faixa>
    )
  }

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
    <Faixa tom="alarme" titulo={titulo}>
      <p className="mt-1 text-sm text-ink-600">{explicacao}</p>

      {/* A mensagem exata, no painel. Da última vez ela existia — catorze mil
          vezes por minuto — e só nos registos. Quem podia agir não a via. */}
      {health.lastError && (
        <p className="mt-2.5 break-words rounded-xl bg-ink-50 px-3 py-2 font-mono text-xs text-ink-600">
          {health.lastError}
        </p>
      )}

      <p className="mt-2 text-xs text-ink-400">
        {health.lastHealthyTickAt
          ? `Última passagem sem erros: ${health.lastHealthyTickAt.toLocaleString('pt-PT')}.`
          : 'Nunca houve uma passagem sem erros.'}
      </p>
    </Faixa>
  )
}
