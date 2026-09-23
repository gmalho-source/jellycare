import type { SVGProps } from 'react'

/**
 * O conjunto de ícones da aplicação.
 *
 * Traçado, 16px, desenhados à mão numa grelha de 16 — e não uma dependência
 * de mil ícones para usar doze. Nenhum é um emoji: um emoji muda de desenho
 * conforme o sistema operativo de quem está a ler, o que num painel de estado
 * é a última coisa que se quer.
 *
 * Os nomes das secções são os mesmos `slug` de `lib/site-nav`, para que a
 * navegação não tenha de manter uma segunda tabela de correspondência.
 */
const TRACOS: Record<string, React.ReactNode> = {
  sites: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1.2" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" />
    </>
  ),
  geral: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2.4" />
      <path d="M2 6.2h12M6.2 6.2V14" />
    </>
  ),
  desempenho: (
    <>
      <path d="M2.6 12a5.6 5.6 0 1 1 10.8 0" />
      <path d="m8 12 2.8-3.4" />
    </>
  ),
  problemas: (
    <>
      <path d="M8 2.6 14 13H2z" />
      <path d="M8 6.4v3M8 11.2v.2" />
    </>
  ),
  seguranca: <path d="m2.4 4.8 1.5 1.5L6.4 3.8M2.4 11.2l1.5 1.5 2.5-2.5M8.8 5h4.8M8.8 11.5h4.8" />,
  formularios: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2.2" />
      <path d="M2 9.4h3l1 1.6h4l1-1.6h3" />
    </>
  ),
  wordpress: (
    <>
      <path d="M8 2.2 14 5.6 8 9 2 5.6z" />
      <path d="M2.4 9.2 8 12.4l5.6-3.2" />
    </>
  ),
  copias: (
    <>
      <rect x="2" y="3" width="12" height="3.2" rx="1.2" />
      <path d="M3.2 6.6V13h9.6V6.6" />
      <path d="M6.6 9.2h2.8" />
    </>
  ),
  relatorios: (
    <>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
      <path d="M6 9h4M6 11.5h3" />
    </>
  ),
  definicoes: (
    <>
      <path d="M3 5h10M3 11h10" />
      <circle cx="6" cy="5" r="1.7" />
      <circle cx="10" cy="11" r="1.7" />
    </>
  ),
  estado: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8.3l2.2 1.4" />
    </>
  ),
  telemovel: (
    <>
      <rect x="4.5" y="2" width="7" height="12" rx="1.6" />
      <path d="M7.2 12.2h1.6" />
    </>
  ),
  computador: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1.4" />
      <path d="M6 13.5h4" />
    </>
  ),
  atualizar: (
    <>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" />
      <path d="M13.4 2.6v3h-3" />
    </>
  ),
  seta: <path d="m6 4 4 4-4 4" />,
  voltar: <path d="m10 4-4 4 4 4" />,
  externo: (
    <>
      <path d="M9.5 3H13v3.5" />
      <path d="M13 3 7.6 8.4" />
      <path d="M11.5 9.6V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.4" />
    </>
  ),
  mais: <path d="M8 3.5v9M3.5 8h9" />,
  saida: (
    <>
      <path d="M6.2 13H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2.2" />
      <path d="M10.5 10.5 13 8l-2.5-2.5M13 8H6.5" />
    </>
  ),
}

export type NomeIcone = keyof typeof TRACOS

export function Icone({
  nome,
  className = 'h-4 w-4',
  ...props
}: { nome: string; className?: string } & Omit<SVGProps<SVGSVGElement>, 'ref'>) {
  const tracos = TRACOS[nome] ?? TRACOS.geral
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...props}
    >
      {tracos}
    </svg>
  )
}
