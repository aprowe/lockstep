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
import { PAIR_DRAG } from './pair-drag'
import { ANCHOR_DRAG } from './anchor-drag'
import { CLIP_BODY_DRAG } from './clip-body-drag'
import { CLIP_EDGE_DRAG } from './clip-edge-drag'

export type { Handle, GestureProfile, ProfileContext } from './types'

export const PROFILES: Partial<Record<Handle['kind'], GestureProfile>> = {
  'pair-drag':     PAIR_DRAG,
  'anchor-drag':   ANCHOR_DRAG,
  'clip-body':     CLIP_BODY_DRAG,
  'clip-in-edge':  CLIP_EDGE_DRAG,
  'clip-out-edge': CLIP_EDGE_DRAG,
}

export function lookupProfile(handle: Handle): GestureProfile | undefined {
  return PROFILES[handle.kind]
}
