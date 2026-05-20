# Interaction Design — Selection, Activation, Hotkeys

> Status: proposal. Some pieces are already implemented (multi-select, lasso,
> per-list filters, click-to-activate-clip); others — most of the keyboard
> shortcuts, the deselection rules, and the inspector wiring — are still
> open. This doc is meant to be the single place we make the decisions
> before sprinkling them across panels.
>
> Earlier draft existed at `docs/SELECTION_DESIGN.md` (deleted; this doc supersedes it).

## Surfaces

There are four kinds of place the user can click:

1. **List panels** — Clips, Markers, Scenes. Each list owns its own
   multi-selection set. Files and Video Info are read-only-ish; they don't
   participate in selection semantics.
2. **Timeline** — multiple horizontal _tracks_ (clip band, marker tracks,
   scene strip, warp connector, etc.). Each track holds items that overlap
   their corresponding list panel's items.
3. **Inspector** — today this is the Clip Info panel showing the active
   clip's BPM / stretch / lock. Future inspector(s) might show the focused
   item from any list.
4. **Player + chrome** — the video pane, toolbar, menu bar, header. These
   should never affect selection.

The mental model: **lists and the timeline are two views of the same data.
Selection state is shared between them.** The inspector watches selection +
active state.

---

## Two distinct concepts: _selection_ and _active_

These are independent. A clip can be selected, active, both, or neither.

| Concept         | Cardinality   | Driven by                                     | Drives                                                                      |
| --------------- | ------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| **Selection**   | many per list | shift/ctrl-click, lasso, ctrl-A               | bulk delete, bulk export, "N selected" UI, accent outlines                  |
| **Active clip** | one (or none) | plain click on a clip, prev/next-clip toolbar | timeline view scoping, Clip Info panel, marker/scene "in this clip" filters |

Markers and scenes have selection but **no active concept** today. Plain
click on a marker / scene seeks the playhead; that's the only side effect.
Whether they should grow an "active" notion (e.g. for an Inspector) is an
open question — see below.

The active clip survives bulk deletion of the multi-selection unless the
active clip itself is in the selection (then `activeRegionId` becomes
`null` and the timeline falls back to "Full Video" mode).

---

## Click semantics

### List rows

| Gesture            | Effect                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plain click**    | Replace this list's selection with `[id]` · fire activate (clips: set active region + seek; markers/scenes: seek)                                                                                |
| **Shift+click**    | Range-extend from the anchor (last plain-click target in this list) to clicked id · selection unioned with prior · _no activate_                                                                 |
| **Ctrl/Cmd+click** | Toggle this id in this list's selection · _no activate_                                                                                                                                          |
| **Checkbox click** | Same as Ctrl+click, never activates                                                                                                                                                              |
| **Double-click**   | List-specific: clip → start inline rename. Marker → seek + zoom-to-marker (?). Scene → seek + zoom-to-scene (?).                                                                                 |
| **Right-click**    | Open context menu. _If the right-clicked item is not already in the selection, add it (or replace selection with it) so menu actions target what the user expected._ (Adobe + Figma convention.) |
| **Drag a row**     | Currently nothing. Could be reorder (clips), or drag-to-export.                                                                                                                                  |

### Timeline items (clips, markers, scenes on tracks)

Same modifier semantics as list rows. Plain click on a timeline clip should
**also** activate it (= same effect as plain-click in the Clips list).
Today this is wired through the dock bridge.

### Timeline empty area — _the deselection question_

This is the part you flagged. Three plausible policies:

**Policy A: click clears every selection across every surface.** Aggressive.
Common in canvas apps (Figma, Photoshop) where there's no concept of
panel-side selection. Bad fit for us — clicking the timeline shouldn't
forget what the user just selected in a panel.

**Policy B: click clears every _timeline-related_ selection (clips,
markers, scenes), leaves panel-only selections alone.** Files panel
selection (if it ever has one) is unaffected. This is what Premiere /
Final Cut do — clicking the empty timeline drops the canvas selection
without touching the project bin's.

**Policy C: click clears only the selections of items on the _track_ you
clicked.** Click empty marker track → deselect markers. Click empty clip
band → deselect clips. Most surgical.

**Recommendation: Policy B.** Reasons:

1. Lists and the timeline mirror the _same_ selections (clip-list ↔ clip
   band, marker-list ↔ marker track, scene-list ↔ scene strip). So
   "clear timeline selections" automatically clears the matching list
   selections too — there's no surprise.
2. Policy C is more surgical but needs the user to understand which
   track they clicked, and we have a lot of narrow tracks. A misclick
   between rows wouldn't do what they expect.
3. Policy B matches every NLE the user is likely to know.

**Active clip is _not_ deselected** by clicking timeline empty. Active
persists until you switch to a different clip or hit "Full Video" in the
clips panel. Premiere / FCP work this way (track focus is sticky).

### Clicking other panels

| Click on…                                                                    | Does it deselect anything?                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Another list panel's row                                                     | No. Each list owns its own selection set; clicks in Markers don't touch Clips.                       |
| Same list panel's row                                                        | Yes — replaces the list's own selection (per the row rules).                                         |
| List panel chrome (header, filter tabs, thumbnail toggle, sub-header inputs) | No.                                                                                                  |
| Inspector panel                                                              | No. The inspector is a passive observer; clicks inside it (e.g. editing BPM) never affect selection. |
| Player / video pane                                                          | No.                                                                                                  |
| Menu bar / toolbar                                                           | No.                                                                                                  |
| Dock chrome (tab strip, sash, empty group area)                              | No.                                                                                                  |

### Drag

| Gesture                                        | Effect                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Drag in timeline empty area** (single track) | Lasso — replaces the corresponding list's selection with the items inside the lasso |
| **Ctrl/Cmd+drag in timeline**                  | Lasso — adds to existing selection                                                  |
| **Shift+drag in timeline**                     | Pan the view (already wired)                                                        |
| **Drag a clip handle**                         | Resize the in or out edge                                                           |
| **Drag the body of a clip**                    | Move the clip; clamps to [0, duration]                                              |
| **Drag in a list**                             | (Future) reorder clips · or drag-to-timeline to send a clip somewhere               |

---

## Modifier conventions

Stick to one OS-conventional set so muscle memory works:

| Modifier           | Across the app means…                             |
| ------------------ | ------------------------------------------------- |
| **Shift**          | Range / extend                                    |
| **Ctrl/Cmd**       | Toggle / additive                                 |
| **Alt/Opt**        | Duplicate (drag) · alternate variant (click)      |
| **Ctrl/Cmd+Shift** | Subtract from selection (rare; used by Photoshop) |

Right now we use Shift for range-select **and** for pan-the-view in the
timeline. That conflict only fires when the user shift-drags in the
timeline empty area (which is the lasso surface). **Resolution:**
shift+drag = pan (no selection change), shift+click on a track item =
range-extend. The `e.shiftKey` check has to look at gesture start.

---

## Keyboard

**Keys are scoped to whichever surface has keyboard focus.** No
persistent "active panel" state — just `tabIndex` + the browser's
`document.activeElement`. Every dock panel and the timeline are
focusable; clicking inside one focuses it.

This is the rule that resolves the "what does Delete delete?" question:

- Focus on a list → Delete removes that list's selection only. Other
  lists are untouched, even if they have selections of their own.
- Focus on the timeline → Delete removes the timeline selection, which
  by virtue of the lists ↔ timeline mirror is the union of clips +
  markers + scenes the user lassoed.
- Focus on the player → media-control keys (Space, J/K/L, comma/period).

This matches every NLE the user is likely to know. The "N selected"
header bar in a list and the lasso outlines on the timeline are the
visible affordances pointing at what their respective Delete keys will
hit, so the destructive action and the affordance live in the same
place the user just looked.

### Universal (any focus)

| Key                              | Effect                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Esc`                            | Cancel current modal action: close context menu, exit rename, cancel lasso. _Does not deselect_ (Esc-to-deselect is a Photoshop convention; we should pick: see open questions). |
| `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z` | Undo / redo (existing)                                                                                                                                                           |
| `Space`                          | Play / pause (existing)                                                                                                                                                          |

### When a list panel is focused

| Key                                           | Effect                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Delete` / `Backspace`                        | Remove every item in this list's selection. Currently wired via `useListSelection`. Active clip drops to `null` only if it was deleted. |
| `Cmd/Ctrl+A`                                  | Select every visible item in this list (respects current filter)                                                                        |
| `Cmd/Ctrl+Shift+A` or `Cmd/Ctrl+D`            | Clear this list's selection                                                                                                             |
| `Up` / `Down`                                 | Move active item one row (and select-only-it)                                                                                           |
| `Shift+Up` / `Shift+Down`                     | Extend selection one row                                                                                                                |
| `Enter`                                       | Open the active item in the inspector (or trigger the activate callback)                                                                |
| `F2` (Win/Linux) or `Enter` (Mac) on selected | Start inline rename for the selected row (clips only today)                                                                             |
| `Home` / `End`                                | Jump to first / last visible item                                                                                                       |

### When the timeline is focused

| Key                      | Effect                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `Delete` / `Backspace`   | Delete the union of clip + marker + scene selections. Lasso-then-Delete is the canonical "wipe a region of the timeline" gesture. |
| `Cmd/Ctrl+D`             | Clear all timeline-side selections (clips + markers + scenes).                                                                    |
| `Esc`                    | Cancel current drag (lasso, region resize). Doesn't deselect — selection clearing is Cmd+D.                                       |
| `+` / `-` (or `=` / `-`) | Zoom timeline horizontally (in addition to wheel)                                                                                 |
| `[` / `]`                | Move active clip to prev / next                                                                                                   |
| `,` / `.`                | Step playhead by frame (existing)                                                                                                 |
| `J` / `K` / `L`          | Reverse / pause / forward (industry convention; FCP, Premiere, Resolve)                                                           |

### When the player is focused

| Key       | Effect                            |
| --------- | --------------------------------- |
| `Space`   | Play / pause                      |
| `M`       | Add marker at playhead (existing) |
| `I` / `O` | Set in / out of active clip       |

---

## Cross-list and cross-surface rules

> These are the rules that resolve the "what does click X actually do?"
> question across the whole app.

1. **Selection is per-list** for clips, markers, scenes. A click in one
   list never alters another list's selection.
2. **Lists ↔ timeline mirror automatically** — the same Redux store backs
   both surfaces (clips list ↔ clip overlay outlines, markers list ↔
   anchor highlights). Implementation today already does this.
3. **Active clip is global, single, persistent.** Set by plain click on a
   clip (in either surface), by Prev/Next Clip toolbar, by clicking "Full
   Video" (which sets it to `null`). Surviving across panel switches and
   selection changes.
4. **Inspector follows in this priority order:**
    1. If a list panel was the most recently interacted surface, show the
       single selected item there (or a "N selected" summary if multi).
    2. Else if there's an active clip, show it.
    3. Else show the empty state.
       This requires a `lastInteractedList` tracker we don't yet have. For
       now, Clip Info just shows the active clip — that's the minimal
       inspector and it works.
5. **Deselection cascades nowhere.** Clearing the markers selection
   doesn't touch clips. Setting the active clip to a new clip doesn't
   clear marker / scene selections. Each axis is independent.
6. **A click that targets a tab strip, group sash, panel header, menubar,
   or toolbar button never changes selection.** These are chrome.

---

## Right-click + selection

Two camps in the wild:

- **Replace-then-act** (Adobe): right-clicking an unselected row replaces
  selection with `[id]` before the menu opens, so menu actions affect just
  that row. Right-clicking a _selected_ row keeps the multi-select.
- **Augment-then-act** (Figma, OS file managers): right-clicking an
  unselected row temporarily _adds_ it to selection just for the menu
  (selection reverts after).

**Recommendation: Replace-then-act.** Simpler to reason about, no hidden
"this menu is acting on a thing that's not visually selected" surprises.
Rule: opening a context menu on an unselected row first does the
equivalent of plain-click on it, then opens the menu.

Today our right-click does _not_ do this — it opens the menu against the
right-clicked row regardless of selection. Picking up #4 from my recent
analysis would fix it.

---

## Drag-and-drop within a list

Not implemented; here's the proposed convention:

- Drag a clip row in the Clips panel → shows a horizontal insert line
  between rows. Drop reorders.
- Reordering changes display order, _not_ the timeline order (in/out
  points still drive that). The display order persists in the regions
  array.
- **Open question:** does reordering the clips list change which clip is
  "next" for Prev/Next Clip navigation? Probably yes.

---

## Hover and focus visuals

| State                  | Visual                                                     |
| ---------------------- | ---------------------------------------------------------- |
| Hover (no other state) | Subtle background bump (`var(--bg-2)`)                     |
| Selected               | Accent-tinted background (`rgba(--accent-rgb, 0.16)`)      |
| Active (clips only)    | Accent left-bar + bold name                                |
| Selected + active      | Both (accent bar over accent-tint)                         |
| Multi-select mode      | Per-row checkbox surfaces; "N selected" status bar appears |
| Track row hover        | Label rail picks up `--bg-hover` (already wired)           |
| Per-row trash button   | Fades in on hover / select / active (already wired)        |

---

## Open questions

1. **Esc behavior.** Should Esc with focus on a list deselect that list?
   Photoshop yes; Premiere no (Esc cancels in-progress only). I lean
   toward Premiere — Cmd+Shift+A or Cmd+D is the "clear selection"
   shortcut, Esc is for cancel.

2. **Marker / scene "active" concept.** Markers and scenes don't have an
   "active one" today. If we add an Inspector that shows "the focused
   marker", we need to track _which_ one. Two options:
    - Implicit: the most-recently-clicked one. Cleared when the user
      deselects.
    - Explicit: a per-list `active` field, like clips. More state, but
      symmetrical.

3. **Bulk delete that includes the active clip.** Today: `activeRegionId`
   becomes `null` and the timeline falls back to "Full Video". Should we
   instead promote the next surviving clip to active, so the user
   doesn't lose timeline scoping? FCP does the latter; Premiere does
   the former.

4. **Selection persistence across video reloads.** Per-list selection
   lives in Redux but isn't written to the saved JSON. Reloading a
   video clears it. Probably the right call — selection is an in-flight
   working state, not a per-video preference. But we should be explicit
   about it.

5. **Lasso direction conventions.** Should a left-to-right lasso behave
   different from right-to-left (e.g. Photoshop's "contains entirely" vs
   "intersects")? Today everything is overlap-based.

6. **Cmd+A scoping.** Falls out of the focus rule: focused list →
   select all in that list. Focused timeline → select every clip +
   marker + scene visible in the current view. Cross-list "select
   absolutely everything" doesn't have a single-key shortcut and
   probably shouldn't — it's never been a useful action in any tool I
   can think of.

7. **Does clicking the Files panel ever deselect anything?** No, per
   the rules above. But if we add per-file selection to the Files panel,
   we need to decide whether that's the same selection surface or a
   different one. Probably different — file selection is "what video to
   load", not "what items to operate on".

---

## What's already done vs proposed

| Feature                                                       | Status                                               |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| Per-list multi-selection                                      | ✅ done (`lists.selection.X` slice + ListPanel)      |
| Click / shift / ctrl / checkbox semantics                     | ✅ done (`useListSelection` hook)                    |
| Per-row delete + bulk delete + Delete-key                     | ✅ done                                              |
| List ↔ timeline mirror (clips, markers)                       | ✅ done                                              |
| Lasso on timeline (clips + markers, additive with Ctrl)       | ✅ done                                              |
| Active clip drives Clip Info panel                            | ✅ done                                              |
| Per-list filter (global / view / clip)                        | ✅ done                                              |
| Click empty timeline area = deselect timeline-side selections | ❌ **not yet** — see Policy B                        |
| Right-click selects-then-menus                                | ❌ **not yet** — see #4 above                        |
| Cmd+A / Cmd+D / Esc / arrow-key navigation in lists           | ❌ not yet                                           |
| Timeline-focused Delete / Cmd+D                               | ❌ no Delete handler bound to the timeline root yet  |
| Scene lasso (timeline drag → `lists.selection.scenes`)        | ❌ scenes selection state exists but no lasso target |
| Inspector showing markers / scenes                            | ❌ not yet                                           |
| Drag-to-reorder clip list                                     | ❌ not yet                                           |
| J/K/L transport                                               | ❌ not yet                                           |
