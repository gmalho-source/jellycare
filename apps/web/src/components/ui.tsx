import type { Severity } from '@jellycare/core'
import type { ReactNode } from 'react'

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Crítico',
  high: 'Elevado',
  medium: 'Médio',
  low: 'Baixo',
  info: 'Informativo',
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`sev-${severity} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  )
}

export function HealthBadge({
  severity,
  openFindings,
}: {
  severity: Severity | null
  openFindings: number
}) {
  if (severity === null) {
    return (
      <span className="sev-ok inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
        Sem problemas
      </span>
    )
  }

  return (
    <span
      className={`sev-${severity} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}
    >
      {SEVERITY_LABEL[severity]} · {openFindings}
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-ink-200 bg-white ${className}`}>{children}</div>
  )
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3.5">
      <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
      {action}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-ink-400">{children}</p>
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

export function formatUptime(value: number | null): string {
  if (value === null) return '—'
  // Duas casas decimais: a diferença entre 99,9% e 99,95% é o que separa o
  // cumprimento do SLA do seu incumprimento.
  return `${value.toFixed(2).replace('.', ',')}%`
}
