import type { Anchor, Region, View, WarpSegment } from '../types'

export type Space = 'input' | 'output'

export interface RegionBlock {
  id: string
  inPoint: number
  outPoint: number
  colorIndex?: number
  /** Drives the timeline view (single). */
  active?: boolean
  /** Member of the multi-select set (independent of active). */
  selected?: boolean
  label?: string
}

export interface TrackDef {
  id: string
  label: string
  h: number
  space: 'input' | 'warp' | 'output'
  flex: number
}

export interface LayoutTrack extends TrackDef {
  y: number
}

export interface HitEntry {
  x: number
  y: number
  w: number
  h: number
  data: unknown
}

export interface Snapshot {
  view: View
  duration: number
  outputDuration: number
  maxDuration: number
  anchors: Anchor[]
  beatAnchors: Anchor[]
  /** Legacy field — retained for downstream visualization (e.g. CanvasTimeline
   *  draws unlinked beat anchors with reduced opacity). The controller does
   *  NOT consult this for anchor-drag propagation: anchor drags are always
   *  space-local. Use the warp-line drag gesture to move a pair together. */
  linkedBeatIds: ReadonlySet<number>
  /** Per-space selection. An anchor id in `selectedOrigAnchorIds` means only
   *  its input-space copy is selected; similarly for `selectedBeatAnchorIds`.
   *  A pair is "fully selected" when the same id is in BOTH sets. */
  selectedOrigAnchorIds: ReadonlySet<number>
  selectedBeatAnchorIds: ReadonlySet<number>
  regions: RegionBlock[]
  regionsOutput?: RegionBlock[]
  /** Full Region objects (including bpm, lock, lockedBeats, inBeatTime, outBeatTime,
   *  anchorLock) for the controller to compute linking-event live previews during
   *  anchor drags (R1 Slice C). Parallel to `regions` but carries the complete
   *  Region type rather than the stripped RegionBlock. Defaults to [] when not
   *  provided so existing code that builds Snapshots without full region data is
   *  unaffected. */
  regionDetails: Region[]
  /** Per-space clip selection. A region id in `selectedClipinIds` means only
   *  its input-space (clipin) copy is selected; similarly for `selectedClipoutIds`.
   *  A region is "fully selected" when the same id is in BOTH sets. */
  selectedClipinIds: ReadonlySet<string>
  selectedClipoutIds: ReadonlySet<string>
  scenes: number[]
  selectedSceneTimes: ReadonlySet<number>
  segments: WarpSegment[]
  bpm: number
  beatOffset?: number
  snapInterval?: number
  snapOffset?: number
  /** Active region's lock mode — used by the controller to compute live BPM /
   *  lockedBeats during an output-space (clipout) edge drag. Undefined when no
   *  region is active or the region has no explicit lock. */
  clipLock?: 'bpm' | 'beats'
  /** Active region's locked beat count when lock='beats'. Used by the
   *  controller to compute live BPM during a clipout edge drag. */
  clipLockedBeats?: number
  /** Active region's anchorLock flag — used by the controller to decide
   *  whether to rescale (resize) or translate (pan) beat anchors during a
   *  clipout edge/body drag. Defaults to false when absent. */
  clipAnchorLock?: boolean
  followDrag: boolean
  warpCollapsed: boolean
  canvas: { width: number; height: number }
  tracks: LayoutTrack[]
  hits: HitEntry[]
  playhead?: number
}

export interface PointerEventLike {
  clientX: number
  clientY: number
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  canvasRect: { left: number; top: number; width: number; height: number }
}

export interface WheelEventLike extends PointerEventLike {
  deltaX: number
  deltaY: number
}

export interface KeyEventLike {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** Selection intent to flush on pointerUp when the gesture turned out to be a
 *  click (no movement past the threshold). Re-uses the existing select intent
 *  shape — emitting these from pointerUp gives "click selects, drag does not"
 *  semantics. */
export type PendingSelect =
  | { kind: 'anchorSelect'; id: number; additive: boolean }
  | { kind: 'beatAnchorSelect'; id: number; additive: boolean }
  | { kind: 'regionSelect'; id: string }

export type DragState =
  | { kind: 'seek'; space: Space }
  | { kind: 'pan'; startClientX: number; startView: View }
  | { kind: 'minimap'; startClientX: number; startView: View }
  | {
      kind: 'anchor'
      id: number
      space: Space
      origTime: number
      liveAnchors: Anchor[]
      liveBeatAnchors: Anchor[]
      /** Cursor position at pointerDown. Used for cursor-pixel-delta computation
       *  (warp-line pair drag) and for the click-vs-drag threshold check that
       *  controls whether pendingSelect fires on pointerUp. */
      startClientX: number
      startClientY: number
      /** True once the cursor moved past the click→drag threshold. Click
       *  semantics (selection on pointerUp) only fire when this is false. */
      moved: boolean
      /** Deferred selection intents flushed on pointerUp if `moved` is false. */
      pendingSelect: PendingSelect[]
      /** True when this is a paired drag (both partners captured for the same
       *  id). Pair drags translate by cursor pixel delta, not by snapped
       *  input-time delta from the grabbed anchor's origTime. */
      isPair: boolean
      /** Same-space anchor ids that participate in this drag (multi-select).
       *  Always includes the dragged id; size > 1 means the user grabbed an
       *  already-selected anchor. Each moves by the same time delta. */
      groupIds?: ReadonlySet<number>
      /** Snapshot of original times keyed by anchor id, per space, used to
       *  apply the delta on every pointerMove. Used by combined-selection
       *  drag to capture BOTH spaces: an input-space anchor drag with a
       *  selected pair will populate both maps and move both partners. */
      origInputTimes?: Map<number, number>
      origBeatTimes?: Map<number, number>
      /** Combined-selection drag: regions captured at pointerDown when the
       *  dragged anchor was already selected. Same time delta applies to
       *  every region, clamped to [0, MAX]. Empty when only anchors are in
       *  the selection. */
      regionGroupIds?: ReadonlySet<string>
      origRegionBounds?: Map<string, { inPoint: number; outPoint: number }>
      liveRegionBounds?: { id: string; inPoint: number; outPoint: number }[]
      /** Output-space anchor drag only: region edges whose beat-space
       *  boundary was coincident with this anchor's beat time at drag start.
       *  During the drag the linked edge follows the anchor live; on
       *  pointerUp a regionResize (isOutput) commit fires per linked edge.
       *  Each entry stores both edge beat times so the non-linked edge can
       *  be preserved when building the output-region override. */
      linkedOutputEdges?: Array<{
        regionId: string
        edge: 'in' | 'out'
        origInBeatTime: number
        origOutBeatTime: number
      }>
    }
  | {
      kind: 'region-edge'
      id: string
      edge: 'in' | 'out'
      isOutput: boolean
      origIn: number
      origOut: number
      liveRegion: { id: string; inPoint: number; outPoint: number } | null
      startClientX: number
      startClientY: number
      moved: boolean
      pendingSelect: PendingSelect[]
      /** Last observed alt-key state during the drag (for anchor-lock flip, §13). */
      lastAltKey: boolean
      /** Live beat-anchor array for Slice B anchor rescale/translate during
       *  output-space edge drags. Initialized to snap.beatAnchors on
       *  pointerDown for all output-space edge drags; undefined for
       *  input-space drags. */
      liveBeatAnchors?: Anchor[]
      /** Snapshot of beat-anchor times at pointerDown (by id) — used as the
       *  origin for Slice B proportional rescale / translate math. Initialized
       *  for all output-space edge drags when anchorLock is relevant. */
      origBeatAnchorTimes?: Map<number, number>
    }
  | {
      kind: 'region-move'
      id: string
      isOutput: boolean
      origIn: number
      origOut: number
      anchorX: number
      liveRegion: { id: string; inPoint: number; outPoint: number } | null
      startClientX: number
      startClientY: number
      moved: boolean
      pendingSelect: PendingSelect[]
      /** Last observed alt-key state during the drag (for anchor-lock flip, §13). */
      lastAltKey: boolean
      /** Region ids that participate in this drag (multi-select). Always
       *  includes the dragged id. When size > 1, the same time delta is
       *  applied to every captured region. */
      groupIds?: ReadonlySet<string>
      /** Snapshot of original (inPoint, outPoint) per region id at drag start. */
      origBounds?: Map<string, { inPoint: number; outPoint: number }>
      /** Live per-region bounds during the drag (parallel to liveRegion but
       *  for every group member). */
      liveBoundsList?: { id: string; inPoint: number; outPoint: number }[]
      /** Combined-selection drag: anchors captured at pointerDown when the
       *  dragged region was already selected. Same time delta applies to
       *  every anchor in both spaces. */
      anchorGroupIds?: ReadonlySet<number>
      origInputAnchorTimes?: Map<number, number>
      origBeatAnchorTimes?: Map<number, number>
      liveAnchors?: Anchor[]
      liveBeatAnchors?: Anchor[]
    }
  | {
      kind: 'lasso'
      startX: number; startY: number
      curX: number; curY: number
      additive: boolean
      /** Initial orig-space anchor ids (from selectedOrigAnchorIds when additive). */
      initialOrigAnchorIds: Set<number>
      /** Initial beat-space anchor ids (from selectedBeatAnchorIds when additive). */
      initialBeatAnchorIds: Set<number>
      /** Initial clipin region ids (from selectedClipinIds when additive). */
      initialClipinIds: Set<string>
      /** Initial clipout region ids (from selectedClipoutIds when additive). */
      initialClipoutIds: Set<string>
      initialSceneTimes: Set<number>
      active: boolean
      /** Orig-space anchors swept by the lasso rectangle. */
      lassoOrigAnchorIds: Set<number>
      /** Beat-space anchors swept by the lasso rectangle. */
      lassoBeatAnchorIds: Set<number>
      /** Clipin regions swept by the lasso rectangle. */
      lassoClipinIds: Set<string>
      /** Clipout regions swept by the lasso rectangle. */
      lassoClipoutIds: Set<string>
      lassoSceneTimes: Set<number>
    }

export type Intent =
  // commits — wrapper forwards to prop callbacks
  | { kind: 'seek' | 'seekBeat'; time: number }
  | { kind: 'viewChange'; view: View }
  | { kind: 'anchorsChanged'; next: Anchor[] }
  | { kind: 'beatAnchorsChanged'; next: Anchor[] }
  | { kind: 'regionResize'; id: string; inPoint: number; outPoint: number; isOutput: boolean; altKey: boolean }
  | { kind: 'regionMove'; id: string; inPoint: number; outPoint: number; isOutput: boolean; altKey: boolean }
  | { kind: 'anchorAdd'; time: number }
  | { kind: 'anchorDelete'; id: number }
  | { kind: 'beatAnchorDelete'; id: number }
  | { kind: 'anchorSelect'; id: number; additive: boolean }
  | { kind: 'beatAnchorSelect'; id: number; additive: boolean }
  | { kind: 'anchorContextMenu'; id: number; x: number; y: number }
  | { kind: 'beatAnchorContextMenu'; id: number; x: number; y: number }
  | { kind: 'sceneContextMenu'; time: number; x: number; y: number }
  | { kind: 'regionContextMenu'; id: string; x: number; y: number }
  | { kind: 'timelineContextMenu'; time: number; x: number; y: number }
  | { kind: 'sceneAdd'; time: number }
  | { kind: 'sceneDelete'; time: number }
  | { kind: 'regionAdd'; time: number }
  | { kind: 'regionSelect'; id: string }
  | { kind: 'regionZoom'; id: string }
  | { kind: 'timelineDeselect' }
  | { kind: 'timelineDelete' }
  | { kind: 'clipsSelectionChange'; clipinIds: Set<string>; clipoutIds: Set<string> }
  | { kind: 'scenesSelectionChange'; times: Set<number> }
  /** Lasso commit: separate orig-space and beat-space anchor id sets. */
  | { kind: 'connectorSelectionChange'; origIds: Set<number>; beatIds: Set<number> }
  // gesture-store publishes — wrapper forwards to src/store/gesture.ts singleton
  // Live drag region bounds (pubDragRegion / pubDragRegions), live BPM
  // (pubLiveBpm), and live lockedBeats (pubLiveLockedBeats) have been removed —
  // the slice is now the live state (controller dispatches commit thunks on
  // every pointerMove). Retained kinds below are still used.
  | { kind: 'pubDragTime'; space: Space | null; time: number | null }
  | { kind: 'pubSnapHints'; space: Space; times: readonly number[] }
  | { kind: 'pubScrubTime'; time: number | null }
  /** Live lasso preview: separate orig and beat anchor id sets for per-space highlighting,
   *  and separate clipin/clipout region id sets. */
  | { kind: 'pubLasso'; clipinIds: Set<string>; clipoutIds: Set<string>; origAnchorIds: Set<number>; beatAnchorIds: Set<number>; sceneTimes: Set<number> }
  | { kind: 'pubClearGesture' }
  /** Publish live beat-anchor positions during a clipout-edge drag that carries a
   *  linked beat anchor. Canvas draws from dragState directly (liveBeatAnchorOverrides);
   *  this intent triggers a redraw. */
  | { kind: 'pubLiveBeatAnchors'; anchors: Anchor[] }
  | { kind: 'pubModifierKeys'; alt: boolean; shift: boolean }
  | { kind: 'pubHoveredAnchor'; id: number | null }
  | { kind: 'pubHoveredRegion'; id: string | null }
  | { kind: 'pubHoveredScene'; time: number | null }
  | { kind: 'pubHoveredWarpLine'; id: number | null }
  | { kind: 'thumbnailHover'; payload: { time: number; x: number; y: number } | null }
  // drag lifecycle — routes to dragSlice actions in applyIntents
  | { kind: 'dragStart' }
  | { kind: 'dragEnd' }
  | { kind: 'dragCancel' }
  // canvas-side hints
  | { kind: 'cursor'; cursor: '' | 'grab' | 'grabbing' | 'ew-resize' | 'pointer' }
  | { kind: 'redraw' }
