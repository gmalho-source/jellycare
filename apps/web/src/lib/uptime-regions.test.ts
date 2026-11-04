import { describe, expect, it } from 'vitest'
import { bestRegionCount } from './uptime-regions'

describe('bestRegionCount', () => {
  it('sem amostras, não há número', () => {
    expect(bestRegionCount([])).toBeNull()
    expect(bestRegionCount([{ up: 0, total: 0 }])).toBeNull()
  })

  it('com uma região, é a contagem dela', () => {
    expect(bestRegionCount([{ up: 280, total: 288 }])).toEqual({ up: 280, total: 288 })
  })

  it('uma região barrada não puxa o site para baixo', () => {
    expect(
      bestRegionCount([
        { up: 0, total: 288 },
        { up: 288, total: 288 },
      ]),
    ).toEqual({ up: 288, total: 288 })
  })
})
