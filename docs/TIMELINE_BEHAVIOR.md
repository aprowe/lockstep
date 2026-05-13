# Timeline Behavior Reference

Comprehensive description of timeline interaction behavior, synthesized from `spec/features/timeline/*.feature`.

The timeline is a horizontally scrubbing region of the UI made up of stacked **tracks** (rows). Each track surfaces a particular *kind* of object — anchors, scenes, regions/clips, the warp connector layer — and each kind responds to pointer, keyboard, and wheel input in a coherent way.

---

## 1. Tracks (Rows) and Object Kinds

| Track / Layer       | Object kind          | Space          |
|---------------------|----------------------|----------------|
| `markerin`          | input anchor         | input          |
| `markerout`         | beat (output) anchor | output / beat  |
| `scenes` / `scene_strip` | scene marker    | input          |
| `clipin` / `region_strip` | region (clip) body in input space | input |
| `clipout`           | region body in beat space (conform display) | output / beat |
| warp connector      | line linking paired input + beat anchors | crosses both spaces |
| ruler / input ruler | playhead scrub surface | input        |

A "space" is either:
- **input space** — original video time
- **output / beat space** — time after BPM warp; ticks reflect the BPM grid

The legacy thin `RegionBand` on `clipout` is **not** a drag target (see §6 and §9).

---

## 2. Pointer Gesture State Machine

A pointerdown on the timeline never immediately selects or moves anything. Instead it **arms** a gesture; what gesture activates depends on what was hit and how the pointer moves.

### 2.1 Arming
- pointerdown in an **empty area** → arms a *lasso* gesture (does not activate yet).
- pointerdown on an **object** (anchor / region body / region edge / warp line / scene) → arms a potential *drag* of that object.

### 2.2 Activation threshold
- A gesture **activates** once the pointer moves more than **4 pixels** from the start position.
- Below the 4-pixel threshold, release becomes a **click** instead of a drag.

### 2.3 pointerUp behaviors
- pointerDown never emits a select intent.
- **pointerUp without movement** = click → emits `*Select` (additive when Shift / Ctrl / Cmd held).
- **pointerUp after movement** = drag commit → emits no `*Select`; the drag did its move.
- **Dragging an unselected object** does a single-object drag (only that object moves); the existing selection is untouched.

### 2.4 Cancel paths — all reset state, none commit
- OS `pointercancel`
- Window `blur`
- `Escape` key

---

## 3. Clicks and Empty-Area Behavior

| Situation | Result |
|-----------|--------|
| Click empty area, no current selection | Playhead jumps to clicked time |
| Click empty area, non-empty selection  | Selection clears, playhead stays |
| Lasso armed but released below 4 px threshold, no modifiers | Regular click at that position |
| Lasso armed below threshold with **Ctrl held** | Playhead seeks; selection is **not** cleared |
| Click unselected anchor (no movement) | Anchor selects on pointerUp |
| Click unselected region body (no movement) | Region selects on pointerUp |
| Click unselected region edge (no movement) | Parent region selects on pointerUp |
| Click warp line (no movement) | **Both** paired anchors select on pointerUp |
| Ruler drag | Continuous scrub; controller publishes `scrubTime` so timecode and minimap update live; playhead follows |

---

## 4. Lasso Selection

Activates after 4 px movement from an empty-area pointerdown.

### 4.1 Track-aware behavior
- The lasso starts in **single-track mode** within the row it began in.
- If the drag enters another track vertically, the lasso **expands** to multi-kind mode and can span object types.
- Vertical coverage decides which selection sets update:
  - covers `markerin` or `markerout` → anchor selection updates
  - covers `clipin` or `clipout` → clip / region selection updates
  - covers `scenes` → scene selection updates
- A lasso spanning **both edges of a clip** selects that clip.

### 4.2 Modifier behavior
- **Ctrl/Cmd held at lasso start** → lasso is **additive** to the existing selection.
- No modifier → lasso **replaces** selection.

---

## 5. Anchor Drag

Anchors come in two flavors that share a `pair id`:
- **input anchor** on the `markerin` row (input space)
- **beat anchor** on the `markerout` row (output / beat space)

### 5.1 Independent drag
- Dragging an **input** anchor moves only the input anchor — the beat partner's time is unchanged.
- Dragging a **beat** anchor moves only the beat anchor — the input partner's time is unchanged.

### 5.2 Snapping
- **Input-space drag** snaps to:
  - scene cuts
  - clip / region edges
  - *No* BPM grid snapping in input space.
- **Output/beat-space drag** snaps to:
  - BPM grid lines, but the effective grid spacing is **never finer than the smallest visible tick**.
- **Snap hints during drag**:
  - Input space: up to **2 candidates on each side** of the cursor are published as preview hints.
  - Output space: **only the currently snapping target** is published as a hint.

### 5.3 Follow-drag
- When Follow-drag is enabled, dragging an anchor **also seeks the playhead** to the anchor's current time.

### 5.4 Conform interaction with clips
- An anchor sitting on a clip boundary causes the clipout track to conform to the anchor's beat output time — both statically and **live** during an anchor drag (see §6.3).
- Dragging an anchor never moves the clip's boundary; only the anchor moves.

---

## 6. Region (Clip) Drag and Bounds

A region has both input-space bounds (`inPoint` / `outPoint`) and beat-space bounds (`inBeatTime` / `outBeatTime`). When the beat-space bounds equal the input bounds, the region is in its **default-linked** state.

### 6.1 Body drag on `clipin`
- Default-linked region: dragging the body moves **both** input and beat-space bounds by the same delta; the linked state is preserved.
- Diverged region (beat ≠ input): dragging the body moves **only** the input bounds (`inPoint` / `outPoint`); beat-space bounds stay put.

### 6.2 Edge drag (resize)
- Edges snap to:
  - **anchors in the matching space**
  - **scene cuts** — only in input space
  - **other regions' edges** — in either space
  - **BPM grid** — only in output space
- During a region-move with edge snapping, the published drag time corresponds to whichever edge **wins** the snap.

### 6.3 Edge clamps
- A resize cannot shrink a region below **0.1 seconds** — the moving edge stops 0.1 s from the opposite edge.
- A resize cannot push an edge outside `[0, MAX]` — the edge stops at the boundary.

### 6.4 `clipout` track behavior
The `clipout` track is the beat-space rendering of the region.

- When **no anchor** sits exactly on the region's in or out point, `clipout` mirrors `clipin` (vertically aligned).
- When an **input anchor** sits exactly on the region's in point, the `clipout` in edge is placed at that anchor's beat-output time, and the out edge sits at `that_beat_time + region.beatDuration`.
- This conforms **live** while an anchor is being dragged: snapping to the boundary makes `clipout` follow the anchor; dragging off the boundary returns `clipout` to vertical alignment.
- Symmetrically: when a **beat anchor** sits on the region's explicit `clipout` in/out beat time, the `clipout` edge follows that beat anchor — also live during a beat-anchor drag.

### 6.5 Conform-driven lock behavior
When a conform changes `clipout`'s beat-space length (because an anchor moved onto a region boundary):

- `lock='bpm'` → BPM stays fixed; **beat count** updates so the new length plays at the same BPM. `clipin` is unchanged.
- `lock='beats'` → beat count stays fixed; **BPM** updates so the same beat count fits the new length. `clipin` is unchanged.

### 6.6 Direct `clipout` edge drag
- Dragging the `clipout` in/out edge resizes the region in beat space; `inBeatTime` / `outBeatTime` update independently of `inPoint` / `outPoint`. After the drag, the region is **no longer default-linked**.
- The drag updates **BPM** (if `lock='bpm'`) or **beat count** (if `lock='beats'`) to remain consistent with the new beat-space length.

### 6.7 Tick grid live update
- The BPM tick grid repositions **in real time** while:
  - dragging a clip in `clipin` (reflects new in-point), or
  - dragging an anchor that sits on the region's in-point (reflects anchor's current beat position).

---

## 7. Warp Connector (Linked-Pair) Behavior

The warp connector is the diagonal line joining an input anchor to its beat partner.

### 7.1 Hover
- Hovering a warp connector publishes a `hovered-warp-line` intent for that pair id; cursor becomes `grab`.
- Leaving onto an empty area publishes `hovered-warp-line: null` and restores the default cursor.

### 7.2 Click vs drag
- **Click without movement** → both partner anchor ids are added to their respective selections; no anchors move.
- **Click + drag in one continuous gesture** → both partners are auto-added to the selection and **both move by the same delta**. This is a combined-selection drag of the auto-selected pair.
- **Dragging a warp line where the pair has no partner** (orphan) → nothing happens; no commit fires.

### 7.3 Delta is cursor-pixel based
- The grab point can be anywhere along the diagonal. The drag translates both anchors by exactly the **cursor pixel delta** (converted to time), **not** by realigning to either anchor's coordinate.
- Example: input anchor at 10 s, beat anchor at 20 s, grab midway, cursor moves 50 px = 5 s → input becomes 15 s, beat becomes 25 s.

### 7.4 Pair-drag snapping
- A paired drag (started from the connector **or** from a selection containing both partner ids) considers snap targets in **both** input space (scenes, clip edges) **and** output space (BPM grid).
- The winning delta aligns whichever side has the closest snap target.

### 7.5 Live updates
- During `pointerMove` of a pair drag, both anchors' live times update by the current delta. `pubDragTime` publishes the drag time for at least one of the two spaces (controller's choice).

---

## 8. Multi-Select / Combined Drag

### 8.1 Same-kind multi-select
- Multiple objects of the same kind selected → dragging any one moves **all** by the same delta; relative spacing is preserved.

### 8.2 Mixed-kind ("combined") drag
- An anchor + a clip + a scene marker all selected → dragging any one moves **all three** by the same delta; each stays in its own track.
- Non-selected objects do not move.

### 8.3 Selection-implied paired drag
- If both an input anchor and its beat partner are in the selection, dragging any selected anchor moves **both spaces** by the same delta — no warp-line gesture needed, the selection already pairs them.

### 8.4 Drag a non-selected object
- Dragging an object that is **not** in the current selection replaces the selection set (for that kind) with just that object, and only that object moves.

### 8.5 Live broadcast for every captured item
The gesture store and canvas reflect **every** captured object during a combined drag:
- Two selected regions, drag one → live in/out points are published for **both** regions during the drag.
- Anchor + two regions selected, drag the anchor → live in/out points are published for **both** regions during the drag (in addition to the anchor).
- A "most recent" singular `dragRegion` remains addressable for legacy consumers.

---

## 9. Cursors

| Hovered hit       | Cursor      |
|-------------------|-------------|
| anchor            | `grab`      |
| region body       | `grab`      |
| region edge       | `ew-resize` |
| scene marker      | `pointer`   |
| warp connector    | `grab`      |

- While **dragging** an anchor or region body, the cursor is `grabbing` for the duration of the drag.

---

## 10. Right-Click (Context Menus)

A right-click anywhere in the timeline opens a three-section menu: **target-specific → track-specific → global timeline actions**. Global actions may be promoted to track-specific when the context calls for it.

### 10.1 Object-targeted right-click

| Hit | Intent / shown actions |
|-----|------------------------|
| anchor (input)           | `anchorContextMenu` — delete, snap, seek, reset link |
| beat anchor (output)     | `beatAnchorContextMenu` |
| region                   | `regionContextMenu` — delete, rename, export, zoom |
| scene marker             | `sceneContextMenu` — delete, rename |
| empty area               | `timelineContextMenu(time)` |
| marker selection (input) | delete, snap, seek, reset link, create clip from markers |
| mixed multi-selection    | delete |

### 10.2 Empty-track right-click

| Layer            | Action shown |
|------------------|--------------|
| `input_timeline` | new marker   |
| `scene_strip`    | new scene    |
| `region_strip`   | new region   |

---

## 11. Double-Click

### 11.1 On objects

| Hit          | Action / intent  |
|--------------|------------------|
| anchor       | `anchorDelete`   |
| scene marker | `sceneDelete`    |
| region       | `regionZoom`     |

### 11.2 On empty area of a track (create)

| Track / row     | Created object   |
|-----------------|------------------|
| `markerin` / `input_timeline` | marker / anchor |
| `scenes` / `scene_strip`      | scene marker    |
| `clipin` / `region_strip`     | region / clip   |

---

## 12. Keyboard

| Keys | Action |
|------|--------|
| `Delete` / `Backspace` (timeline focused) | `timelineDelete` |
| `Cmd` / `Ctrl` + `D` (timeline focused)   | `timelineDeselect` |
| `Escape` during drag                      | Resets drag state, no commit |

---

## 13. Viewport (Pan, Zoom, Minimap)

### 13.1 Wheel
- No modifier: wheel scroll **pans horizontally**; zoom span unchanged.
- `Shift` + wheel: pans horizontally even when `deltaY` is 0 (so trackpad horizontal flicks work).
- `Ctrl` / `Cmd` + wheel: **zooms around the cursor** — the time under the cursor stays under the cursor.

### 13.2 Drag-pan
- `Alt` + click + drag → pans viewport by the drag delta.
- Middle-mouse drag → pans viewport by the drag delta.

### 13.3 Minimap
- Click on the minimap → viewport recenters on that time; **span is preserved**.
- Drag across the minimap → continuous recenter follows the cursor.

### 13.4 Clamps
- Min zoom span: **0.1 seconds**.
- Max zoom span: **2 × video duration**.
- Viewport edges are always clamped to `[0, videoDuration]`.

### 13.5 Zoom-to-region toggle
- Invoke once → viewport zooms to fit the region (region becomes 100% of timeline).
- Invoke again on the **same** region while still centered on it → restores the previous view.

---

## 14. Region Creation Rules

### 14.1 Default size
Span is the **larger of**: 10% of viewport span, or **5 seconds**.

| Viewport span | New region span |
|---------------|-----------------|
| 20 s          | 5 s             |
| 40 s          | 5 s             |
| 50 s          | 5 s             |
| 200 s         | 20 s            |

### 14.2 Anchor position
- Created from the timeline → aligned at the **cursor position**.
- Created from the region list (no cursor) → aligned at the **playhead**.

### 14.3 Clamping to video
- New region's in-point is clamped to `≥ 0`.
- New region's out-point is clamped to `≤ videoDuration`.

### 14.4 Scene- and region-aware bounds
With scene markers or other regions present, a new region fills the gap around the cursor:
- in-point = **latest of**: previous scene marker, end of previous region, viewport start
- out-point = **earliest of**: next scene marker, start of next region, viewport end
- Then clamped to `[0, videoDuration]`.

| Setup (viewport 50–90, cursor at 60) | Result |
|--------------------------------------|--------|
| No scenes, no regions                | 60–65 (falls back to 5 s rule) |
| Scenes at 55 and 70                  | 55–70 (snaps between) |
| Scene at 55 only                     | 55–90 (out stops at viewport end) |
| Scene at 80 only                     | 50–80 (in starts at viewport start) |
| Scenes at 10 and 110 (out of view)   | 50–90 (fills viewport) |
| Scene at 55 + region 60–70, cursor 80 | 70–100 (prev region wins over earlier scene) |
| Scene at 95 + region 80–90, cursor 60 | 50–80 (next region wins over later scene) |
| Cursor *inside* an existing region 60–70 + scene at 80 | 70–80 (behaves as if playhead is just past the region's out) |

### 14.5 Selection on create
- The newly created region is **selected**.
- The viewport does **not** change.

---

## 15. Region Bounds Editing

### 15.1 Undo
- Changing a region's start or end is **undoable** — undo restores prior in/out.

### 15.2 In/out inversion shifts the region
- Setting **in > out** by direct edit moves the region rather than inverting it: e.g. region 10–20, set in to 25 → region becomes **25–35** (length preserved).
- Setting **Out Point** via button when the playhead is **before** the region's in → creates a **new region** starting at the playhead, sized by the standard 10% / 5 s rule (capped up to the next region).
- Setting **In Point** via button when the playhead is **after** the region's out → mirror behavior: new region at the playhead, sized by the same rule.

### 15.3 Minimum-length clamp
For a region 10–20 with min length 1:

| Attempted resize | Result |
|------------------|--------|
| in→10, out→10    | 10–11  |
| in→10, out→10.5  | 10–11  |
| in→20, out→20    | 19–20  |
| in→19.5, out→20  | 19–20  |

### 15.4 Zoom action on a region
- Double-click a region (or invoke its zoom action) → viewport becomes exactly `{ start: regionIn, end: regionOut }` (region fills the timeline).
- Invoking zoom again on the same region while still centered on it → **restores the previous view**.

---

## 16. Scenes (Auxiliary Behavior)

- Hovering a scene diamond positions the global **scene-thumbnail popup** at that diamond; hovering off hides it.
- Scene right-click and double-click follow the standard table in §10 and §11.

---

## 17. Selection Model — Quick Recap

A few invariants worth keeping in mind:

1. **pointerDown never selects.** Selection happens on pointerUp (click) or never (drag).
2. **Dragging an unselected object** does not modify other selections; only the dragged object moves.
3. **Dragging a selected object** performs the combined drag of every selected item — the selection set is **unchanged** after pointerUp.
4. **Clicking a warp line** selects both paired anchors. **Dragging** a warp line both selects and moves them.
5. Cancel paths (`pointercancel`, blur, `Escape`) **never** commit and **never** modify selection.
