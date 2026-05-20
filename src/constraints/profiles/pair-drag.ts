/**
 * PAIR_DRAG — warp-connector / paired-anchor drag.
 *
 * The user grabs the connector between an orig and beat anchor pair.
 * Both partners translate together by the same delta, regardless of
 * link state (linked pairs naturally do this via their DirectedPair;
 * unlinked pairs need a TranslateGroup that we install for the gesture
 * duration).
 *
 *   onDrag:         Move op on the orig anchor. TranslateGroup carries
 *                   the same delta to beat in the resolver, so a single
 *                   op is sufficient.
 *   whileDragging:  TranslateGroup over [orig, beat]. Bidirectional —
 *                   either entity can drive — but the only writes come
 *                   from onDrag's Move on orig, so it acts one-way in
 *                   practice.
 *
 * Snap install stays on the legacy `dragCtx.snapInstall` path until the
 * snap-consolidation step migrates it into a profile field. The controller
 * continues to emit snapStart/snapEnd intents for pair drags.
 */

import { ConstraintKind, OpKind } from '../types'
import { anchorInId, anchorOutId } from '../ids'
import type { GestureProfile } from './types'

export const PAIR_DRAG: GestureProfile = {
  onDrag: (handle, delta) => {
    if (handle.kind !== 'pair-drag') return []
    return [{ kind: OpKind.Move, id: anchorInId(handle.pairId), delta }]
  },
  whileDragging: (handle) => {
    if (handle.kind !== 'pair-drag') return []
    return [
      {
        kind: ConstraintKind.TranslateGroup,
        ids:  [anchorInId(handle.pairId), anchorOutId(handle.pairId)],
        tag:  `gesture:pair:${handle.pairId}`,
      },
    ]
  },
}
