'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

interface Turno {
  role: 'user' | 'assistant'
  content: string
}

/**
 * A resposta do modelo, desenhada.
 *
 * Em elementos React e nunca por `innerHTML`: isto é texto gerado por um
 * modelo a partir, entre outras coisas, de conteúdo recolhido do site de um
 * terceiro. O React escapa tudo o que passa por aqui, e assim não há caminho
 * nenhum por onde uma resposta injete marcação na página.
 *
 * Só blocos de código e parágrafos. Um bloco de configuração para colar num
 * nginx é a razão de existir deste painel e tem de dar para copiar sem
 * apanhar reticências pelo meio; o resto é prosa e lê-se bem como prosa.
 */
function Resposta({ texto }: { texto: string }) {
  const partes = texto.split(/```/)

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-ink-900">
      {partes.map((parte, indice) =>
        // Os índices ímpares estão entre crases: são código. Um bloco ainda
        // por fechar — o streaming corta a meio — cai aqui na mesma e
        // desenha-se como código, que é o que ele é.
        indice % 2 === 1 ? (
          <pre
            key={indice}
            className="overflow-x-auto rounded-lg bg-shell px-3.5 py-3 font-mono text-xs leading-relaxed text-shell-text"
          >
            <code>{parte.replace(/^[a-z]*\n/, '')}</code>
          </pre>
        ) : (
          parte
            .split(/\n{2,}/)
            .filter((paragrafo) => paragrafo.trim().length > 0)
            .map((paragrafo, sub) => (
              <p key={`${indice}-${sub}`} className="whitespace-pre-wrap">
                {paragrafo.trim()}
              </p>
            ))
        ),
      )}
    </div>
  )
}

/**
 * A linha de um problema, com o assistente técnico por baixo.
 *
 * Envolve a linha inteira e não só o botão porque o painel tem de abrir à
 * largura toda: uma resposta com um bloco de configuração não cabe na coluna
 * dos botões, e a primeira tentativa esmagou a linha contra a margem.
 *
 * Fechado por omissão e aberto a pedido: isto custa dinheiro a cada resposta
 * e não se dispara por uma página carregar. O primeiro clique já leva a
 * pergunta implícita — explica isto e como o resolvo — porque é a mesma de
 * todas as vezes e obrigar a escrevê-la seria cerimónia.
 */
export function Apoio({
  findingId,
  titulo,
  podeApoiar,
  acoes,
  children,
}: {
  findingId: string
  titulo: string
  /** Só a equipa. Um cliente pertence à organização e via o botão na mesma. */
  podeApoiar: boolean
  /** Reconhecer e silenciar: são do servidor e passam por aqui só para ficarem na mesma fila. */
  acoes: ReactNode
  /** O problema em si. */
  children: ReactNode
}) {
  const [aberto, setAberto] = useState(false)
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [aChegar, setAChegar] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pergunta, setPergunta] = useState('')
  const fim = useRef<HTMLDivElement>(null)

  const perguntar = useCallback(
    async (texto: string) => {
      setOcupado(true)
      setErro(null)
      if (texto) setTurnos((anteriores) => [...anteriores, { role: 'user', content: texto }])

      try {
        const resposta = await fetch(`/api/assistente/${findingId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pergunta: texto }),
        })

        if (!resposta.ok || !resposta.body) {
          const corpo = (await resposta.json().catch(() => ({}))) as { detalhe?: string }
          setErro(corpo.detalhe ?? 'O assistente não respondeu. Tente outra vez.')
          return
        }

        const leitor = resposta.body.getReader()
        const decoder = new TextDecoder()
        let acumulado = ''
        for (;;) {
          const { done, value } = await leitor.read()
          if (done) break
          acumulado += decoder.decode(value, { stream: true })
          setAChegar(acumulado)
        }

        setTurnos((anteriores) => [...anteriores, { role: 'assistant', content: acumulado }])
        setAChegar('')
      } catch {
        setErro('A ligação caiu a meio da resposta.')
      } finally {
        setOcupado(false)
      }
    },
    [findingId],
  )

  const abrir = useCallback(async () => {
    setAberto(true)
    // A conversa que já houve sobre este problema. Sem isto, quem volta ao
    // painel amanhã vê uma caixa vazia e pergunta tudo outra vez.
    const resposta = await fetch(`/api/assistente/${findingId}`)
    const corpo = (await resposta.json().catch(() => ({}))) as { turnos?: Turno[] }
    const anteriores = corpo.turnos ?? []
    setTurnos(anteriores)
    if (anteriores.length === 0) await perguntar('')
  }, [findingId, perguntar])

  useEffect(() => {
    if (aChegar) fim.current?.scrollIntoView({ block: 'nearest' })
  }, [aChegar])

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">{children}</div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {acoes}
          {podeApoiar && !aberto ? (
            <button
              type="button"
              onClick={abrir}
              className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
              title="Abre o assistente técnico sobre este problema. Só a equipa vê isto."
            >
              Pedir apoio
            </button>
          ) : null}
        </div>
      </div>

      {aberto ? (
        <div className="mt-3 rounded-xl border border-ink-200 bg-ink-50/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">
              Assistente técnico · {titulo}
            </p>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-xs text-ink-400 hover:text-ink-900"
            >
              Fechar
            </button>
          </div>

          <div className="max-h-[32rem] space-y-4 overflow-y-auto">
            {turnos.map((turno, indice) =>
              turno.role === 'user' ? (
                <p key={indice} className="text-sm font-medium text-ink-600">
                  {turno.content}
                </p>
              ) : (
                <Resposta key={indice} texto={turno.content} />
              ),
            )}
            {aChegar ? <Resposta texto={aChegar} /> : null}
            {ocupado && !aChegar ? <p className="text-sm text-ink-400">A pensar…</p> : null}
            <div ref={fim} />
          </div>

          {erro ? <p className="mt-3 text-sm text-alarme">{erro}</p> : null}

          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(evento) => {
              evento.preventDefault()
              const texto = pergunta.trim()
              if (!texto || ocupado) return
              setPergunta('')
              void perguntar(texto)
            }}
          >
            <input
              value={pergunta}
              onChange={(evento) => setPergunta(evento.target.value)}
              placeholder="Perguntar mais alguma coisa sobre este problema…"
              className="min-w-[14rem] flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={ocupado || pergunta.trim().length === 0}
              className="inline-flex min-h-10 items-center rounded-lg bg-ink-900 px-3.5 text-sm font-medium text-white hover:bg-ink-900/90 disabled:opacity-50"
            >
              Perguntar
            </button>
          </form>

          <p className="mt-2 text-xs text-ink-400">
            Quem confirma que ficou resolvido é a verificação, na passagem seguinte — não isto.
          </p>
        </div>
      ) : null}
    </>
  )
}
