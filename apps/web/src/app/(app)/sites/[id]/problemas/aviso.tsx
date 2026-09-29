'use client'

import { useCallback, useEffect, useState } from 'react'

interface AvisoRegistado {
  id: string
  recipients: string[]
  subject: string
  createdAt: string
  sentAt: string | null
  error: string | null
  sentByEmail: string | null
}

interface Rascunho {
  assunto: string
  corpo: string
  destinatarios: string[]
}

interface Sugestao {
  email: string
  acesso: boolean
  relatorios: boolean
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function origem(sugestao: Sugestao | undefined): string | null {
  if (!sugestao) return null
  if (sugestao.acesso && sugestao.relatorios) return 'portal e relatórios'
  if (sugestao.acesso) return 'acesso ao portal'
  return 'recebe relatórios'
}

/**
 * Para quem vai o aviso.
 *
 * Uma lista e não uma caixa de texto: cada pessoa sai com um clique, e diz de
 * onde veio — quem tem acesso ao portal e quem recebe o relatório nem sempre
 * são as mesmas pessoas, e é isso que se decide aqui. As sugestões tiradas
 * ficam à vista por baixo para voltarem a entrar sem ter de as escrever, e
 * qualquer outro endereço acrescenta-se à mão.
 */
function Destinatarios({
  escolhidos,
  sugestoes,
  mudar,
}: {
  escolhidos: string[]
  sugestoes: Sugestao[]
  mudar: (proximos: string[]) => void
}) {
  const [novo, setNovo] = useState('')
  const [invalido, setInvalido] = useState<string | null>(null)
  const porEmail = new Map(sugestoes.map((sugestao) => [sugestao.email, sugestao]))
  const porEscolher = sugestoes.filter((sugestao) => !escolhidos.includes(sugestao.email))

  const acrescentar = () => {
    const partes = novo
      .split(/[\s,;]+/)
      .map((parte) => parte.trim().toLowerCase())
      .filter(Boolean)
    if (partes.length === 0) return
    const maus = partes.filter((parte) => !EMAIL.test(parte))
    if (maus.length > 0) {
      setInvalido(`Não é um endereço de email: ${maus.join(', ')}`)
      return
    }
    mudar([...escolhidos, ...partes.filter((parte) => !escolhidos.includes(parte))])
    setNovo('')
    setInvalido(null)
  }

  return (
    <div>
      <p className="text-xs text-ink-400">Para</p>
      <ul className="mt-1 flex flex-wrap gap-2" aria-label="Destinatários">
        {escolhidos.map((email) => (
          <li
            key={email}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-ink-50 py-1 pl-3 pr-1 text-sm text-ink-900"
          >
            {email}
            {origem(porEmail.get(email)) ? (
              <span className="text-xs text-ink-400">· {origem(porEmail.get(email))}</span>
            ) : null}
            <button
              type="button"
              onClick={() => mudar(escolhidos.filter((outro) => outro !== email))}
              aria-label={`Tirar ${email}`}
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 hover:bg-ink-200 hover:text-ink-900"
            >
              ×
            </button>
          </li>
        ))}
        {escolhidos.length === 0 ? (
          <li className="py-1 text-sm text-alarme">Ninguém escolhido ainda.</li>
        ) : null}
      </ul>

      {porEscolher.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
          <span>Sugeridos:</span>
          {porEscolher.map((sugestao) => (
            <button
              key={sugestao.email}
              type="button"
              onClick={() => mudar([...escolhidos, sugestao.email])}
              aria-label={`Acrescentar ${sugestao.email}`}
              className="rounded-full border border-dashed border-ink-200 px-2.5 py-1 text-ink-600 hover:border-ink-400 hover:text-ink-900"
            >
              + {sugestao.email} · {origem(sugestao)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="email"
          name="novo-destinatario"
          value={novo}
          onChange={(evento) => {
            setNovo(evento.target.value)
            setInvalido(null)
          }}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter' || evento.key === ',') {
              evento.preventDefault()
              acrescentar()
            }
          }}
          placeholder="Acrescentar outro email"
          className="min-w-[14rem] flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={acrescentar}
          className="inline-flex min-h-10 items-center rounded-lg border border-ink-200 px-3.5 text-sm text-ink-600 hover:bg-ink-100"
        >
          Acrescentar
        </button>
      </div>
      {invalido ? <p className="mt-1 text-xs text-alarme">{invalido}</p> : null}
    </div>
  )
}

const DATA = new Intl.DateTimeFormat('pt-PT', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Lisbon',
})

const CAMPO =
  'mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none'

/**
 * Avisar o cliente sobre um problema, com revisão obrigatória.
 *
 * Só para os casos em que a resolução não está do lado da Jelly. Quando está,
 * resolve-se e não se manda email nenhum — e o texto por cima do botão diz
 * isso, porque é a pergunta que se tem de fazer antes de carregar.
 *
 * O modelo escreve um rascunho e a pessoa decide. Não há caminho entre o
 * rascunho e o envio que não passe por este formulário: o que sai é o que
 * ficou nos campos, e é isso que fica registado.
 */
export function AvisoAoCliente({ findingId }: { findingId: string }) {
  const [avisos, setAvisos] = useState<AvisoRegistado[]>([])
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [instrucoes, setInstrucoes] = useState('')
  const [aRedigir, setARedigir] = useState(false)
  const [aEnviar, setAEnviar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviado, setEnviado] = useState<string | null>(null)

  const carregarRegisto = useCallback(async () => {
    const resposta = await fetch(`/api/assistente/${findingId}/avisos`)
    const corpo = (await resposta.json().catch(() => ({}))) as { avisos?: AvisoRegistado[] }
    setAvisos(corpo.avisos ?? [])
  }, [findingId])

  useEffect(() => {
    void carregarRegisto()
  }, [carregarRegisto])

  const redigir = useCallback(
    async (pedido: string) => {
      setARedigir(true)
      setErro(null)
      setEnviado(null)
      try {
        const resposta = await fetch(`/api/assistente/${findingId}/avisos/rascunho`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instrucoes: pedido }),
        })
        const corpo = (await resposta.json().catch(() => ({}))) as {
          assunto?: string
          corpo?: string
          destinatarios?: string[]
          sugestoes?: Sugestao[]
          detalhe?: string
        }
        if (!resposta.ok || corpo.assunto === undefined || corpo.corpo === undefined) {
          setErro(corpo.detalhe ?? 'Não foi possível preparar o rascunho.')
          return
        }
        // Os destinatários que a pessoa já tinha escrito ficam: pedir outra
        // versão do texto não é pedir outra lista de pessoas.
        setRascunho((anterior) => ({
          assunto: corpo.assunto!,
          corpo: corpo.corpo!,
          destinatarios: anterior?.destinatarios ?? corpo.destinatarios ?? [],
        }))
        setSugestoes(corpo.sugestoes ?? [])
        setInstrucoes('')
      } catch {
        setErro('A ligação caiu enquanto o rascunho era preparado.')
      } finally {
        setARedigir(false)
      }
    },
    [findingId],
  )

  const enviar = useCallback(async () => {
    if (!rascunho) return
    setAEnviar(true)
    setErro(null)
    try {
      const resposta = await fetch(`/api/assistente/${findingId}/avisos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rascunho),
      })
      const corpo = (await resposta.json().catch(() => ({}))) as { detalhe?: string }
      if (!resposta.ok) {
        setErro(corpo.detalhe ?? 'O envio falhou.')
      } else {
        setEnviado(rascunho.destinatarios.join(', '))
        setRascunho(null)
      }
    } catch {
      setErro('A ligação caiu durante o envio. Veja o registo antes de tentar outra vez.')
    } finally {
      setAEnviar(false)
      // Mesmo quando falha: a tentativa ficou registada e tem de aparecer.
      void carregarRegisto()
    }
  }, [findingId, rascunho, carregarRegisto])

  return (
    <div className="mt-4 border-t border-ink-200 pt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">
        Aviso ao cliente
      </p>

      {!rascunho ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="min-w-[16rem] flex-1 text-xs text-ink-400">
            Só quando a resolução não está do nosso lado — um acesso que não temos, uma decisão
            dele, um fornecedor que só ele pode contactar. O que conseguimos resolver, resolvemos,
            e não se manda email nenhum.
          </p>
          <button
            type="button"
            disabled={aRedigir}
            onClick={() => void redigir('')}
            className="inline-flex min-h-10 items-center rounded-lg border border-ink-200 bg-white px-3.5 text-sm font-medium text-ink-900 hover:bg-ink-100 disabled:opacity-60"
          >
            {aRedigir ? 'A preparar o rascunho…' : 'Preparar aviso ao cliente'}
          </button>
        </div>
      ) : (
        <form
          className="mt-3 space-y-3 rounded-xl border border-ink-200 bg-white p-4"
          onSubmit={(evento) => {
            evento.preventDefault()
            void enviar()
          }}
        >
          <p className="text-xs text-ink-600">
            Rascunho preparado pelo assistente. <strong>Leia antes de enviar</strong>: sai em nome
            da Jelly, tal como estiver aqui, e as respostas do cliente vêm para si.
          </p>

          <Destinatarios
            escolhidos={rascunho.destinatarios}
            sugestoes={sugestoes}
            mudar={(proximos) => setRascunho({ ...rascunho, destinatarios: proximos })}
          />

          <label className="block text-xs text-ink-400">
            Assunto
            <input
              name="assunto"
              value={rascunho.assunto}
              onChange={(evento) => setRascunho({ ...rascunho, assunto: evento.target.value })}
              className={CAMPO}
            />
          </label>

          <label className="block text-xs text-ink-400">
            Texto
            <textarea
              name="corpo"
              rows={12}
              value={rascunho.corpo}
              onChange={(evento) => setRascunho({ ...rascunho, corpo: evento.target.value })}
              className={`${CAMPO} leading-relaxed`}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={instrucoes}
              onChange={(evento) => setInstrucoes(evento.target.value)}
              placeholder="Outra versão: mais curta, mencionar a chamada de ontem…"
              className="min-w-[14rem] flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-jelly-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={aRedigir || aEnviar}
              onClick={() => void redigir(instrucoes)}
              className="inline-flex min-h-10 items-center rounded-lg border border-ink-200 px-3.5 text-sm text-ink-600 hover:bg-ink-100 disabled:opacity-60"
            >
              {aRedigir ? 'A reescrever…' : 'Pedir outra versão'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-3">
            <button
              type="submit"
              disabled={aEnviar || aRedigir || rascunho.destinatarios.length === 0}
              className="inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:opacity-60"
            >
              {aEnviar ? 'A enviar…' : 'Enviar ao cliente'}
            </button>
            <button
              type="button"
              onClick={() => setRascunho(null)}
              className="text-sm text-ink-400 hover:text-ink-900"
            >
              Descartar
            </button>
          </div>
        </form>
      )}

      {erro ? <p className="mt-3 text-sm text-alarme">{erro}</p> : null}
      {enviado ? <p className="mt-3 text-sm text-ink-600">Aviso enviado a {enviado}.</p> : null}

      {/* O registo. É por aqui que a equipa sabe, antes de escrever outra
          vez, que o cliente já foi avisado — e se o aviso chegou a sair. */}
      {avisos.length > 0 ? (
        <ul className="mt-4 space-y-1.5 text-xs">
          {avisos.map((aviso) => (
            <li key={aviso.id} className="flex flex-wrap gap-x-2 text-ink-400">
              <span className={aviso.sentAt ? 'text-ink-600' : 'text-alarme'}>
                {aviso.sentAt ? 'Enviado' : 'Não saiu'}
              </span>
              <span>{DATA.format(new Date(aviso.sentAt ?? aviso.createdAt))}</span>
              <span>·</span>
              <span className="text-ink-600">{aviso.subject}</span>
              <span>· para {aviso.recipients.join(', ')}</span>
              {aviso.sentByEmail ? <span>· por {aviso.sentByEmail}</span> : null}
              {aviso.error ? <span className="w-full text-alarme">{aviso.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
