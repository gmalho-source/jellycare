import dynamic from 'next/dynamic'

/**
 * O gráfico de tempo de resposta é o pedaço mais pesado da secção de
 * desempenho (~17 KB de fonte, cliente). Carregá-lo em lazy corta-o do
 * First Load das outras rotas e deixa a faixa de PageSpeed pintar primeiro.
 */
export const ResponseTimeChartLazy = dynamic(
  () => import('./response-time-chart').then((m) => m.ResponseTimeChart),
  {
    loading: () => (
      <div
        className="mx-5 my-4 h-56 animate-pulse rounded-xl bg-ink-100"
        aria-hidden
      />
    ),
  },
)
