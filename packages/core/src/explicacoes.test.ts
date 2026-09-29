import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EXPLICACOES, explicacaoDe } from './explicacoes.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..', '..')

/** Onde vivem os checks que emitem findings. */
const FONTES = [
  'packages/checks/src',
  'packages/forms/src',
  'packages/connectors/src',
  'apps/worker/src',
]

/**
 * Os códigos que o código emite mesmo, lidos da fonte.
 *
 * Um teste que lê ficheiros é invulgar e aqui ganha o lugar: a alternativa era
 * uma lista escrita à mão que não tem como ficar errada de forma visível. Isto
 * falha no dia em que alguém acrescenta um check e não escreve a explicação —
 * que é exatamente o dia em que um cliente passaria a ver um problema sem
 * tradução nenhuma.
 *
 * Apanha também os códigos em ternários, que foi por onde escaparam vinte e
 * dois numa primeira contagem feita a olho.
 */
function codigosEmitidos(): string[] {
  const codigos = new Set<string>()

  for (const pasta of FONTES) {
    let ficheiros: string[]
    try {
      ficheiros = readdirSync(join(RAIZ, pasta))
    } catch {
      continue
    }

    for (const ficheiro of ficheiros) {
      if (!ficheiro.endsWith('.ts')) continue
      if (ficheiro.endsWith('.test.ts') || ficheiro === 'test-utils.ts') continue

      const fonte = readFileSync(join(RAIZ, pasta, ficheiro), 'utf8')
      for (const encontrado of fonte.matchAll(/code: (?:\w+ \? )?'([a-z_]+)'(?: : '([a-z_]+)')?/g)) {
        if (encontrado[1]) codigos.add(encontrado[1])
        if (encontrado[2]) codigos.add(encontrado[2])
      }
    }
  }

  // Resposta da API da WP Umbrella e não um problema de um site.
  codigos.delete('success')
  return [...codigos].sort()
}

describe('explicações para o cliente', () => {
  it('cobre todos os códigos que os checks emitem', () => {
    const emFalta = codigosEmitidos().filter((codigo) => !(codigo in EXPLICACOES))
    expect(emFalta).toEqual([])
  })

  it('não tem explicações para códigos que já ninguém emite', () => {
    // Texto órfão não faz mal a ninguém, mas é sinal de que um check foi
    // removido e ficou coisa por limpar — e de que o inventário aqui deixou
    // de bater certo com a realidade.
    const emitidos = new Set(codigosEmitidos())
    const orfaos = Object.keys(EXPLICACOES).filter((codigo) => !emitidos.has(codigo))
    expect(orfaos).toEqual([])
  })

  it('encontra mesmo códigos na fonte, incluindo os de ternários', () => {
    // Guarda-costas do próprio teste: se a expressão deixar de apanhar nada,
    // os dois testes acima passam a validar o vazio e ninguém dá por isso.
    const emitidos = codigosEmitidos()
    expect(emitidos.length).toBeGreaterThan(60)
    expect(emitidos).toContain('missing_hsts')
    expect(emitidos).toContain('asset_missing')
    expect(emitidos).toContain('wp_known_vulnerability')
  })

  it('escreve as quatro partes de cada explicação, sem jargão no título', () => {
    for (const [codigo, explicacao] of Object.entries(EXPLICACOES)) {
      expect(explicacao.titulo.length, codigo).toBeGreaterThan(10)
      expect(explicacao.oQueE.length, codigo).toBeGreaterThan(30)
      expect(explicacao.porqueImporta.length, codigo).toBeGreaterThan(30)
      expect(explicacao.oQueFazemos.length, codigo).toBeGreaterThan(20)

      // O título é a única linha que o cliente lê de certeza. Nenhum destes
      // termos diz nada a quem não é da área, e estavam todos nos títulos
      // técnicos que este texto veio substituir.
      for (const jargao of ['header', 'HSTS', 'CSP', 'SPF', 'DKIM', 'DMARC', 'MX', 'XML-RPC', 'TLS']) {
        expect(explicacao.titulo, `${codigo} tem jargão no título`).not.toContain(jargao)
      }
    }
  })

  it('devolve null para um código que não conhece', () => {
    expect(explicacaoDe('codigo_que_nao_existe')).toBeNull()
    expect(explicacaoDe('missing_hsts')).not.toBeNull()
  })
})
