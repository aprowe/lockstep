/**
 * Vitest bridge for the behavior registry.
 *
 * behaviorTest(id, fn)
 *   Wraps a describe() block.  The title becomes "[id] Scenario title"
 *   so every test run shows the behavior ID and human-readable name.
 *   Throws at collection time if the ID is missing from the registry —
 *   i.e. run `npm run behaviors:parse` whenever .feature files change.
 *
 * b(id)
 *   Returns "[id] Scenario title". Use inside an it() label when a
 *   single test fully covers one behavior on its own.
 */

import { describe, it } from 'vitest'
import registryData from '../../generated/behavior-registry.json'

interface BehaviorEntry {
  feature: string
  scenario: string
  isOutline: boolean
  steps: string[]
  file: string
  line: number
}

const registry = registryData.behaviors as Record<string, BehaviorEntry>

export function behaviorTest(id: string, fn: () => void): void {
  const entry = registry[id]
  if (!entry) {
    describe(`[unknown behavior: ${id}]`, () => {
      it('behavior ID not found in registry', () => {
        throw new Error(
          `Behavior ID "${id}" not found in generated/behavior-registry.json.\n` +
          `Run: npm run behaviors:parse`,
        )
      })
    })
    return
  }
  describe(`[${id}] ${entry.scenario}`, fn)
}

/** Returns the labeled scenario title, for use in it() descriptions. */
export function b(id: string): string {
  const entry = registry[id]
  return entry ? `[${id}] ${entry.scenario}` : `[unknown: ${id}]`
}
