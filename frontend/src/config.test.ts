import { describe, expect, it } from 'vitest'

import { normalizeLineFrequencyHz } from './config'

describe('mains-frequency normalization', () => {
  it('preserves valid operator frequencies', () => {
    expect(normalizeLineFrequencyHz(50)).toBe(50)
    expect(normalizeLineFrequencyHz(60)).toBe(60)
  })

  it('falls back to the UK default for missing or invalid values', () => {
    expect(normalizeLineFrequencyHz(Number.NaN)).toBe(50)
    expect(normalizeLineFrequencyHz(0)).toBe(50)
    expect(normalizeLineFrequencyHz(121)).toBe(50)
  })
})
