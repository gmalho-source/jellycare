import { describe, expect, it } from 'vitest'
import { resolveTopology } from './regions.js'

describe('resolveTopology', () => {
  it('sem nada configurado, é uma região só e principal', () => {
    expect(resolveTopology({})).toEqual({
      region: 'eu-west',
      regions: ['eu-west'],
      primary: true,
      multiRegion: false,
    })
  })

  it('Frankfurt continua a chamar-se eu-central', () => {
    expect(resolveTopology({ FLY_REGION: 'fra' }).region).toBe('eu-central')
    expect(resolveTopology({ FLY_REGION: 'mad' }).region).toBe('eu-south')
    expect(resolveTopology({ FLY_REGION: 'sin' }).region).toBe('fly-sin')
  })

  it('JELLYCARE_REGION sobrepõe-se à região do Fly', () => {
    expect(resolveTopology({ FLY_REGION: 'fra', JELLYCARE_REGION: 'eu-west' }).region).toBe('eu-west')
  })

  it('a primeira região da lista é a principal', () => {
    const env = { JELLYCARE_REGIONS: 'eu-central, eu-south' }
    expect(resolveTopology({ ...env, FLY_REGION: 'fra' })).toMatchObject({
      region: 'eu-central',
      primary: true,
      multiRegion: true,
    })
    expect(resolveTopology({ ...env, FLY_REGION: 'mad' })).toMatchObject({
      region: 'eu-south',
      primary: false,
      multiRegion: true,
    })
  })

  it('recusa uma instância fora da lista', () => {
    expect(() =>
      resolveTopology({ JELLYCARE_REGIONS: 'eu-central,eu-south', FLY_REGION: 'ams' }),
    ).toThrow(/não está em JELLYCARE_REGIONS/)
  })

  it('recusa nomes que o BullMQ não aceita', () => {
    expect(() => resolveTopology({ JELLYCARE_REGIONS: 'eu:central', JELLYCARE_REGION: 'eu:central' })).toThrow(
      /inválido/,
    )
  })
})
