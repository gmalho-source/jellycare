import type { Severity } from '@jellycare/core'
import type { ReactNode } from 'react'

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Crítico',
  high: 'Elevado',
  medium: 'Médio',
  low: 'Baixo',
  info: 'Informativo',
}

/**
 * A pastilha de gravidade.
 *
 * O ponto cheio ao lado do texto vem de `--sev-ponto`, definido na própria
 * classe `sev-*`: o texto tem de ser escuro para se ler sobre o fundo claro,
 * e um texto escuro sozinho não se distingue de relance numa lista de vinte
 * linhas. O ponto é que se vê primeiro.
 */
function Pastilha({ severity, children }: { severity: Severity | 'ok'; children: ReactNode }) {
  return (
    <span
      className={`sev-${severity} inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold`}
    >
      <span aria-hidden className="sev-ponto h-1.5 w-1.5 rounded-full" />
      {children}
    </span>
  )
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Pastilha severity={severity}>{SEVERITY_LABEL[severity]}</Pastilha>
}

export function HealthBadge({
  severity,
  openFindings,
}: {
  severity: Severity | null
  openFindings: number
}) {
  if (severity === null) return <Pastilha severity="ok">Sem problemas</Pastilha>

  return (
    <Pastilha severity={severity}>
      {SEVERITY_LABEL[severity]} · {openFindings}
    </Pastilha>
  )
}

/**
 * Um cartão. Sem moldura, com sombra.
 *
 * Uma moldura de 1px à volta de cada cartão desenha uma grelha de linhas que
 * compete com o conteúdo; a sombra separa o cartão do papel sem acrescentar
 * mais uma linha ao ecrã.
 */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white shadow-card ${className}`}>{children}</div>
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
      <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
      {action}
    </div>
  )
}

/** O rótulo pequeno em versaletes que encima um número ou uma secção. */
export function Rotulo({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-400 ${className}`}
    >
      {children}
    </span>
  )
}

/**
 * Um número em destaque com o seu rótulo e uma linha de contexto.
 *
 * O contexto não é decoração: «3» não diz nada, «3 — 1 crítico, 2 elevados»
 * decide o que se faz a seguir.
 */
export function Stat({
  rotulo,
  valor,
  nota,
}: {
  rotulo: string
  valor: ReactNode
  nota?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl bg-white px-5 py-4 shadow-card">
      <span className="text-xs font-medium text-ink-400">{rotulo}</span>
      <span className="font-display text-3xl font-semibold tracking-tight tabular-nums">
        {valor}
      </span>
      {nota !== undefined && <span className="text-xs text-ink-400">{nota}</span>}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-ink-400">{children}</p>
}

export type DateLike = Date | string | number | null | undefined

/**
 * Aceita o que a base de dados devolver.
 *
 * Nem todas as colunas chegam como `Date` — uma agregação em SQL cru devolve
 * texto — e um formatador de apresentação não deve deitar a página abaixo por
 * causa disso.
 */
function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Datas sempre em português europeu e no fuso de Lisboa. */
export function formatDateTime(value: DateLike): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Lisbon',
  }).format(date)
}

export function formatRelative(value: DateLike): string {
  const date = toDate(value)
  if (!date) return 'nunca'
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  const formatter = new Intl.RelativeTimeFormat('pt-PT', { numeric: 'auto' })

  if (seconds < 60) return formatter.format(-seconds, 'second')
  if (seconds < 3600) return formatter.format(-Math.round(seconds / 60), 'minute')
  if (seconds < 86_400) return formatter.format(-Math.round(seconds / 3600), 'hour')
  return formatter.format(-Math.round(seconds / 86_400), 'day')
}

/**
 * Um número em português: vírgula decimal e sem separador de milhares.
 *
 * `toFixed` devolve sempre ponto, que num painel português se lê como um
 * separador de milhares e transforma 1,8 s em mil e oitocentos.
 */
export function formatNumero(valor: number, casas: number): string {
  return new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
    useGrouping: false,
  }).format(valor)
}

export function formatUptime(value: number | null): string {
  if (value === null) return '—'
  // Duas casas decimais: a diferença entre 99,9% e 99,95% é o que separa o
  // cumprimento do SLA do seu incumprimento.
  return `${value.toFixed(2).replace('.', ',')}%`
}
