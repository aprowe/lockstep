import type { Anchor, Region, View, WarpSegment } from "../types";
import type { State as ConstraintState } from "../constraints/types";

export type Space = "input" | "output";

export interface RegionBlock {
    id: string;
    inPoint: number;
    outPoint: number;
    colorIndex?: number;
    /** Drives the timeline view (single). */
    active?: boolean;
    /** Member of the multi-select set (independent of active). */
    selected?: boolean;
    label?: string;
}

export interface TrackDef {
    id: string;
    label: string;
    h: number;
    space: "input" | "warp" | "output";
    flex: number;
}

export interface LayoutTrack extends TrackDef {
    y: number;
}

export interface HitEntry {
    x: number;
    y: number;
    w: number;
    h: number;
    data: unknown;
}

export interface Snapshot {
    view: View;
    duration: number;
    outputDuration: number;
    maxDuration: number;
    anchors: Anchor[];
    beatAnchors: Anchor[];
    /** Beat-anchor ids whose input partner sits at the same time (within
     *  tolerance). Used by CanvasTimeline to draw unlinked beat anchors with
     *  reduced opacity. The controller does NOT consult this for anchor-drag
     *  propagation: solo anchor drags are space-local. Use the warp-line drag
     *  gesture to move a pair together. */
    linkedBeatIds: ReadonlySet<number>;
    /** Per-space selection. An anchor id in `selectedOrigAnchorIds` means only
     *  its input-space copy is selected; similarly for `selectedBeatAnchorIds`.
     *  A pair is "fully selected" when the same id is in BOTH sets. */
    selectedOrigAnchorIds: ReadonlySet<number>;
    selectedBeatAnchorIds: ReadonlySet<number>;
    regions: RegionBlock[];
    regionsOutput?: RegionBlock[];
    /** Full Region objects (bpm, lock, lockedBeats, inBeatTime, outBeatTime,
     *  anchorLock) for the controller to compute linking-event live previews
     *  during anchor drags. Parallel to `regions` but carries the complete
     *  Region type rather than the stripped RegionBlock. Defaults to [] when
     *  not provided. */
    regionDetails: Region[];
    /** Per-space clip selection. A region id in `selectedClipinIds` means only
     *  its input-space (clipin) copy is selected; similarly for `selectedClipoutIds`.
     *  A region is "fully selected" when the same id is in BOTH sets. */
    selectedClipinIds: ReadonlySet<string>;
    selectedClipoutIds: ReadonlySet<string>;
    scenes: number[];
    selectedSceneTimes: ReadonlySet<number>;
    segments: WarpSegment[];
    bpm: number;
    beatOffset?: number;
    snapInterval?: number;
    snapOffset?: number;
    /** Active region's lock mode — used by the controller to compute live BPM /
     *  lockedBeats during an output-space (clipout) edge drag. Undefined when no
     *  region is active or the region has no explicit lock. */
    clipLock?: "bpm" | "beats";
    /** Active region's locked beat count when lock='beats'. Used by the
     *  controller to compute live BPM during a clipout edge drag. */
    clipLockedBeats?: number;
    /** Active region's anchorLock flag — used by the controller to decide
     *  whether to rescale (resize) or translate (pan) beat anchors during a
     *  clipout edge/body drag. Defaults to false when absent. */
    clipAnchorLock?: boolean;
    followDrag: boolean;
    /** Which timeline mode is active. 'warp' is the default multi-track view;
     *  'condensed' is a single overlaid row with scrub-by-default drag. */
    timelineMode: "warp" | "condensed";
    warpCollapsed: boolean;
    canvas: { width: number; height: number };
    tracks: LayoutTrack[];
    hits: HitEntry[];
    playhead?: number;
    /** Constraint graph at snapshot time. The controller calls
     *  findSnapCandidates against it for snap-hint rendering. Optional so
     *  Snapshots built without graph access are still valid. */
    constraintGraph?: ConstraintState;
}

export interface PointerEventLike {
    clientX: number;
    clientY: number;
    button: number;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    canvasRect: { left: number; top: number; width: number; height: number };
}

export interface WheelEventLike extends PointerEventLike {
    deltaX: number;
    deltaY: number;
}

export interface KeyEventLike {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
}

/** Selection intent flushed on pointerUp when the gesture turned out to be a
 *  click (no movement past the threshold). Re-uses the existing select-intent
 *  shape — emitting these from pointerUp gives "click selects, drag does not"
 *  semantics. */
export type PendingSelect =
    | { kind: "anchorSelect"; id: number; additive: boolean }
    | { kind: "beatAnchorSelect"; id: number; additive: boolean }
    | { kind: "regionSelect"; id: string };

export type DragState =
    | { kind: "seek"; space: Space }
    | { kind: "pan"; startClientX: number; startView: View }
    | { kind: "minimap"; startClientX: number; startView: View }
    | {
          kind: "anchor";
          id: number;
          space: Space;
          origTime: number;
          /** Cursor position at pointerDown. Used for cursor-pixel-delta computation
           *  (warp-line pair drag) and for the click-vs-drag threshold check that
           *  controls whether pendingSelect fires on pointerUp. */
          startClientX: number;
          startClientY: number;
          /** True once the cursor moved past the click→drag threshold. Click
           *  semantics (selection on pointerUp) only fire when this is false. */
          moved: boolean;
          /** Deferred selection intents flushed on pointerUp if `moved` is false. */
          pendingSelect: PendingSelect[];
          /** True when this is a paired drag (both partners captured for the same
           *  id). Pair drags translate by cursor pixel delta, not by snapped
           *  input-time delta from the grabbed anchor's origTime. */
          isPair: boolean;
          /** Profile handle for the active drag, set at pointerDown when the
           *  controller emits `beginDrag`. When set, handleAnchorMove emits
           *  the profile-driven `drag` intent instead of `anchorEntityMove`.
           *  Distinct from `isPair`, which is also true for conformed-input
           *  single-anchor drags that do not use a profile. */
          profileHandle?: import("../constraints/profiles/types").Handle;
          /** Same-space anchor ids that participate in this drag (multi-select).
           *  Always includes the dragged id; size > 1 means the user grabbed an
           *  already-selected anchor. Each moves by the same time delta. */
          groupIds?: ReadonlySet<number>;
          /** Which spaces the PRIMARY grabbed anchor was captured in. Drives
           *  intent emission: only emit anchorEntityMove for a space when the
           *  corresponding flag is true. Combined-selection drags (selected pair)
           *  set both; single-space drags set one. */
          capturedSpaces: { input: boolean; beat: boolean };
          /** Pre-drag time of the PARTNER anchor for pair/conformed drags. Only
           *  meaningful when both capturedSpaces.input and .beat are true. Set at
           *  pointerDown from snap; persists for the duration of the drag (snap
           *  values move during pointerMove as the slice updates live). For
           *  single-space drags this is `origTime`. */
          partnerOrigTime: number;
          /** Last computed dragged-space time from pointerMove. pointerUp
           *  reads this to re-emit the final commit without needing the
           *  pointer event. It is the controller's own record of what it last
           *  computed — not a mirror of slice state. */
          lastTime?: number;
      }
    | {
          kind: "region-edge";
          id: string;
          edge: "in" | "out";
          isOutput: boolean;
          origIn: number;
          origOut: number;
          startClientX: number;
          startClientY: number;
          moved: boolean;
          pendingSelect: PendingSelect[];
          /** Last observed alt-key state during the drag (toggles the
           *  anchor-lock flip). */
          lastAltKey: boolean;
          /** Snapshot of beat-anchor times at pointerDown, keyed by id. Used
           *  as the origin for proportional rescale / translate math.
           *  Initialized for all output-space edge drags so handleRegionEdgeMove
           *  can compute rescaled beat-anchor positions inline. Undefined for
           *  input-space drags. */
          origBeatAnchorTimes?: Map<number, number>;
          /** Last computed (newIn, newOut) from pointerMove. pointerUp reads
           *  these to re-emit the final regionResize commit. */
          lastIn?: number;
          lastOut?: number;
          /** Profile handle when this drag is profile-driven (single-edge
           *  drag). Combined-gesture or coupled cases fall through to the
           *  regionResize emit path. */
          profileHandle?: import("../constraints/profiles/types").Handle;
      }
    | {
          kind: "region-move";
          id: string;
          isOutput: boolean;
          origIn: number;
          origOut: number;
          anchorX: number;
          startClientX: number;
          startClientY: number;
          moved: boolean;
          pendingSelect: PendingSelect[];
          /** Last observed alt-key state during the drag (toggles the
           *  anchor-lock flip). */
          lastAltKey: boolean;
          /** Region ids that participate in this drag (multi-select). Always
           *  includes the dragged id. When size > 1, the same time delta is
           *  applied to every captured region. */
          groupIds?: ReadonlySet<string>;
          /** Snapshot of original (inPoint, outPoint) per region id at drag start. */
          origBounds?: Map<string, { inPoint: number; outPoint: number }>;
          /** Combined-selection drag: anchors captured at pointerDown when the
           *  dragged region was already selected. The same time delta applies
           *  to every anchor in both spaces. */
          anchorGroupIds?: ReadonlySet<number>;
          origInputAnchorTimes?: Map<number, number>;
          origBeatAnchorTimes?: Map<number, number>;
          /** Last computed delta from pointerMove. pointerUp reads this to
           *  re-emit the final regionEntityMove commit. */
          lastDelta?: number;
          /** Profile handle when this drag is profile-driven (single-clip
           *  body drag). Combined-gesture cases fall through to the
           *  regionEntityMove emit path. */
          profileHandle?: import("../constraints/profiles/types").Handle;
      }
    | {
          kind: "lasso";
          startX: number;
          startY: number;
          curX: number;
          curY: number;
          additive: boolean;
          /** Initial orig-space anchor ids (from selectedOrigAnchorIds when additive). */
          initialOrigAnchorIds: Set<number>;
          /** Initial beat-space anchor ids (from selectedBeatAnchorIds when additive). */
          initialBeatAnchorIds: Set<number>;
          /** Initial clipin region ids (from selectedClipinIds when additive). */
          initialClipinIds: Set<string>;
          /** Initial clipout region ids (from selectedClipoutIds when additive). */
          initialClipoutIds: Set<string>;
          initialSceneTimes: Set<number>;
          active: boolean;
          /** Orig-space anchors swept by the lasso rectangle. */
          lassoOrigAnchorIds: Set<number>;
          /** Beat-space anchors swept by the lasso rectangle. */
          lassoBeatAnchorIds: Set<number>;
          /** Clipin regions swept by the lasso rectangle. */
          lassoClipinIds: Set<string>;
          /** Clipout regions swept by the lasso rectangle. */
          lassoClipoutIds: Set<string>;
          lassoSceneTimes: Set<number>;
      }
    | {
          kind: "scrub";
          startClientX: number;
          startClientY: number;
          moved: boolean;
      };

export type Intent =
    // commits — wrapper forwards to prop callbacks
    | { kind: "seek" | "seekBeat"; time: number }
    /** Condensed-mode scrub: write `warp.playhead` directly. Not routed
     *  through the constraint pipeline; not snapshotted into history. */
    | { kind: "setPlayhead"; tSec: number }
    | { kind: "viewChange"; view: View }
    | { kind: "anchorsChanged"; next: Anchor[] }
    | { kind: "beatAnchorsChanged"; next: Anchor[] }
    /** Single-entity anchor move. Carries the graph entity ID of the PRIMARY
     *  grabbed anchor and its new absolute time. The resolver's lasso:main
     *  TranslateGroup propagates the implied delta to all other selected
     *  entities. */
    | { kind: "anchorEntityMove"; entityId: string; time: number }
    /** Single-entity region body move. Carries the region's slice id, the
     *  signed translate delta for the PRIMARY grabbed region, and the
     *  space/modifier context for caller routing. The resolver's lasso:main
     *  TranslateGroup propagates to other selected regions. `isOutput`
     *  distinguishes clipin (input-space) vs clipout (output-space) drags. */
    | { kind: "regionEntityMove"; id: string; delta: number; isOutput: boolean; altKey: boolean }
    | {
          kind: "regionResize";
          id: string;
          inPoint: number;
          outPoint: number;
          isOutput: boolean;
          altKey: boolean;
      }
    | {
          kind: "regionMove";
          id: string;
          inPoint: number;
          outPoint: number;
          isOutput: boolean;
          altKey: boolean;
      }
    | { kind: "anchorAdd"; time: number }
    | { kind: "anchorDelete"; id: number }
    | { kind: "beatAnchorDelete"; id: number }
    | { kind: "anchorSelect"; id: number; additive: boolean }
    | { kind: "beatAnchorSelect"; id: number; additive: boolean }
    | { kind: "anchorContextMenu"; id: number; x: number; y: number }
    | { kind: "beatAnchorContextMenu"; id: number; x: number; y: number }
    | { kind: "sceneContextMenu"; time: number; x: number; y: number }
    | { kind: "regionContextMenu"; id: string; x: number; y: number }
    | { kind: "timelineContextMenu"; time: number; x: number; y: number }
    | { kind: "sceneAdd"; time: number }
    | { kind: "sceneDelete"; time: number }
    | { kind: "regionAdd"; time: number }
    | { kind: "regionSelect"; id: string }
    | { kind: "regionZoom"; id: string }
    | { kind: "timelineDeselect" }
    | { kind: "timelineDelete" }
    | { kind: "clipsSelectionChange"; clipinIds: Set<string>; clipoutIds: Set<string> }
    | { kind: "scenesSelectionChange"; times: Set<number> }
    /** Lasso commit: separate orig-space and beat-space anchor id sets. */
    | { kind: "connectorSelectionChange"; origIds: Set<number>; beatIds: Set<number> }
    // gesture-store publishes — wrapper forwards to the gesture singleton.
    // Drag-time live state lives in the slice; commit thunks fire every
    // pointerMove. The kinds below publish UI-only hints.
    | { kind: "pubDragTime"; space: Space | null; time: number | null }
    | { kind: "pubSnapHints"; space: Space; times: readonly number[] }
    | { kind: "pubScrubTime"; time: number | null }
    /** Live lasso preview: separate orig and beat anchor id sets for per-space highlighting,
     *  and separate clipin/clipout region id sets. */
    | {
          kind: "pubLasso";
          clipinIds: Set<string>;
          clipoutIds: Set<string>;
          origAnchorIds: Set<number>;
          beatAnchorIds: Set<number>;
          sceneTimes: Set<number>;
      }
    | { kind: "pubClearGesture" }
    | { kind: "pubModifierKeys"; alt: boolean; shift: boolean }
    | { kind: "pubHoveredAnchor"; id: number | null }
    | { kind: "pubHoveredRegion"; id: string | null }
    | { kind: "pubHoveredScene"; time: number | null }
    | { kind: "pubHoveredWarpLine"; id: number | null }
    | { kind: "thumbnailHover"; payload: { time: number; x: number; y: number } | null }
    // drag lifecycle — routes to dragSlice actions in applyIntents
    | { kind: "dragStart" }
    | { kind: "dragEnd" }
    | { kind: "dragCancel" }
    /** Profile-driven drag lifecycle. `beginDrag` snapshots preDrag, records
     *  the active handle, and stores the controller's pixel-to-time
     *  conversion plus an optional beat-grid so the profile's whileDragging
     *  can compute snap thresholds in entity-time units. */
    | {
          kind: "beginDrag";
          handle: import("../constraints/profiles/types").Handle;
          pxPerUnit?: number;
          grid?: { interval: number; offset: number };
      }
    | { kind: "drag"; delta: number; modifiers: { alt: boolean } }
    | { kind: "endDrag" }
    // canvas-side hints
    | { kind: "cursor"; cursor: "" | "grab" | "grabbing" | "ew-resize" | "pointer" }
    | { kind: "redraw" };
