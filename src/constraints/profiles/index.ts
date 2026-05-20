/**
 * Gesture profile registry.
 *
 * Maps each handle kind to a GestureProfile. `lookupProfile` is the single
 * point of dispatch — the drag thunks call it to translate intents to ops
 * and `buildGraphFromSlice` calls it to inject the gesture-scoped
 * constraints declared in `whileDragging`.
 *
 * Profiles register here as they're implemented. Unknown handle kinds
 * return `undefined` — the caller must no-op cleanly.
 */

import type { GestureProfile, Handle } from './types'

export type { Handle, GestureProfile, ProfileContext } from './types'

export const PROFILES: Partial<Record<Handle['kind'], GestureProfile>> = {}

export function lookupProfile(handle: Handle): GestureProfile | undefined {
  return PROFILES[handle.kind]
}
