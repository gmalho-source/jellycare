import { describe, expect, it } from 'vitest'
import { filtrarSites, normalizar, vistaSitesDe } from './pesquisa-sites'

const SITES = [
  { label: 'ACPA', hostname: 'acpa.pt', url: 'https://acpa.pt' },
  { label: 'Clínica Sorriso — Lisboa', hostname: 'clinicasorriso.pt', url: 'https://www.clinicasorriso.pt' },
  { label: 'Strivesync', hostname: 'strivesync.ai', url: 'https://strivesync.ai' },
]

describe('filtrarSites', () => {
  it('sem termo, devolve todos pela ordem em que vieram', () => {
    expect(filtrarSites(SITES, '   ')).toEqual(SITES)
  })

  it('ignora acentos e maiúsculas, e cada palavra pode estar em qualquer lado', () => {
    expect(filtrarSites(SITES, 'CLINICA lisboa').map((s) => s.label)).toEqual(['Clínica Sorriso — Lisboa'])
  })

  it('encontra pelo domínio', () => {
    expect(filtrarSites(SITES, '.ai').map((s) => s.hostname)).toEqual(['strivesync.ai'])
    expect(filtrarSites(SITES, 'acpa.pt').map((s) => s.label)).toEqual(['ACPA'])
  })

  it('todas as palavras têm de aparecer', () => {
    expect(filtrarSites(SITES, 'acpa lisboa')).toEqual([])
  })
})

describe('normalizar', () => {
  it('tira acentos e cedilhas', () => {
    expect(normalizar('  Ação Ótima ')).toBe('acao otima')
  })
})

describe('vistaSitesDe', () => {
  it('lista por omissão, grelha só quando escolhida', () => {
    expect(vistaSitesDe(undefined)).toBe('lista')
    expect(vistaSitesDe('qualquer')).toBe('lista')
    expect(vistaSitesDe('grelha')).toBe('grelha')
  })
})
