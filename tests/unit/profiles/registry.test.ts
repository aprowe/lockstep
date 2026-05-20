import { describe, it, expect } from 'vitest'
import { PROFILES, lookupProfile } from '../../../src/constraints/profiles'

describe('profile registry', () => {
  it('exposes a PROFILES object keyed by handle kind', () => {
    expect(PROFILES).toBeDefined()
    expect(typeof PROFILES).toBe('object')
  })

  it('lookupProfile returns undefined for unknown handles', () => {
    const result = lookupProfile({ kind: 'unknown-handle' } as never)
    expect(result).toBeUndefined()
  })
})
