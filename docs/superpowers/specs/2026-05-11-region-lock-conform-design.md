# Region Lock, Conform, and Clipout Manipulation — Design

**Status:** in design (open questions flagged inline)
**Date:** 2026-05-11

This document defines how a region's three coupled quantities — **clipout length**, **BPM**, and **beat count** — interact under user gestures: anchor-on-boundary conforms, beat-space anchor drags, clipout edge drags, and clipout body translation. It also defines the *link* between anchors and clip boundaries, and what "BPM" means in two possible mental models.

---

## 1. Foundational concepts

### 1.1 The three coupled quantities

Every region has three quantities related by:

```
beats = clipoutLength × BPM / 60
```

Only two are independent. Which two are independent is determined by `region.lock`:

- `lock = 'bpm'` → **BPM** and **clipoutLength** are independent; **beats** derives.
- `lock = 'beats'` → **beats** (`lockedBeats`) and **clipoutLength** are independent; **BPM** derives.
- (There is no `lock = 'length'` today. If we wanted "BPM and beats are independent, length derives," that would be the third symmetric option.)

`lock` decides which quantity *absorbs* a change when another changes. It does **not** dictate which quantity the user is allowed to edit.

### 1.2 Input space vs beat space

A region has two parallel sets of bounds:

| Space | Region bounds | Anchors | Track |
|---|---|---|---|
| Input | `inPoint`, `outPoint` (seconds in source video) | input anchors (markerin row) | `clipin` |
| Beat / output | `inBeatTime`, `outBeatTime` (seconds in warped output) | beat anchors (markerout row) | `clipout` |

When `inBeatTime === inPoint` and `outBeatTime === outPoint`, the region is **default-linked** (the two spaces coincide). After any operation that diverges them, the region is in a **diverged** state — `clipout` no longer mirrors `clipin`.

### 1.3 Anchor pairs

Anchors come in linked pairs sharing a `pair id`:
- one **input anchor** at some input time `t`
- one **beat anchor** at some beat time `T`

These pairs are global to the warp (stored in `WarpData`), not owned by a region. A single anchor pair may fall inside zero, one, or multiple regions.

---

## 2. The "linked-to-anchor" boundary state

### 2.1 Definition (derived, not stored)

A clip boundary is **linked** to an anchor iff its input-space coord coincides with an input anchor's input time:

```
region.inPoint  === someInputAnchor.inputTime  → in-edge is linked to that anchor
region.outPoint === someInputAnchor.inputTime  → out-edge is linked to that anchor
```

The link is **derived state**, recomputed each frame from current positions. It is not a stored relationship. The link is automatic — any coincidence (drag-snap, Set-In/Out button, programmatic) establishes it; any operation that breaks coincidence dissolves it.

### 2.2 What the link expresses

While the in-edge is linked to an anchor:

- The `clipout`'s in-edge **displays** at the paired beat anchor's beat time `T` (not at `inPoint`).
- This is the conform effect already in §6.4 of `TIMELINE_BEHAVIOR.md`.

While the out-edge is linked, same story with the out-anchor.

### 2.3 Live preview vs commit

All effects of linking and conform happen **live** during a drag. None of it persists or enters the undo stack until **pointerUp**. If the gesture ends without satisfying the commit conditions for that gesture (see §3, §4, §5), the preview is discarded and nothing changes.

---

## 3. Linking event (entering linked state)

### 3.1 Trigger

The in-edge of a region newly coincides with an input anchor's input time. Any path triggers it equally:
- the user drags an anchor onto the boundary
- the user drags the clip body or edge onto an anchor
- the user clicks **Set In Point** / **Set Out Point** when the playhead is on an anchor
- programmatic state changes that produce coincidence

Same for the out-edge.

### 3.2 Commit (on pointerUp at coincidence)

When the gesture ends with coincidence still in effect:

- `region.inBeatTime` (or `outBeatTime`) := paired beat anchor's beat time `T`
- `region.lockedBeats` := new `clipoutLength × region.bpm / 60`
- `region.bpm` is **unchanged**
- `region.lock` is **unchanged**

**The linking event always behaves like `lock='bpm'`** — BPM stays, beats absorbs the change — regardless of the region's actual lock setting. Rationale: linking is the user expressing *where this edge sits in beat-space*. The total beat count of the clip is what implicitly redefines, not the tempo of the music.

### 3.3 No commit if coincidence broken before pointerUp

If the anchor (or clip) is dragged past the boundary and released elsewhere, no commit fires. The live preview is discarded; `inBeatTime`/`outBeatTime`/`lockedBeats` revert to their pre-drag values.

---

## 4. Linked-anchor move

### 4.1 Trigger

While a region's in-edge is linked to an anchor pair, the user drags the **beat (output)** anchor of that pair in output space. The input anchor's input time `t` doesn't change — so `t === inPoint` still holds — so the edge stays linked throughout the drag.

### 4.2 Commit (on pointerUp)

- `region.inBeatTime` (or `outBeatTime`) := beat anchor's new beat time `T'`
- The new `clipoutLength` is derived from the new beat-space coords.
- **`region.lock` decides** what absorbs the length change:
  - `lock='bpm'` → BPM stays; `lockedBeats := clipoutLength × bpm / 60`
  - `lock='beats'` → `lockedBeats` stays; `bpm := 60 × lockedBeats / clipoutLength`

### 4.3 Why this differs from the linking event

The linking event is the user *defining* where the edge sits in beat-space — it's a fresh assertion, and total-beats is the natural derived quantity. Once linked, subsequent moves of the same anchor are *manipulations* of an existing relationship, and the user's `lock` setting expresses which quantity they want preserved across that manipulation.

---

## 5. Clipout manipulation (direct)

Direct manipulation of the clipout is allowed in three forms: **in-edge drag**, **out-edge drag**, and **body translation**. All commit on pointerUp.

### 5.1 Clipout in-edge drag

- Drag the in-edge of the clipout in beat space.
- `region.inBeatTime` moves with the cursor (with snap to anchors, regions, BPM grid in output space).
- `clipoutLength` changes.
- **Lock decides** what absorbs the change (same as §4.2): `lock='bpm'` → beats updates; `lock='beats'` → BPM updates.
- If the in-edge was linked at drag start, the link **breaks immediately on movement** — `inBeatTime` is now diverged from the anchor's beat time `T`.
- `clipin`'s `inPoint` is **unchanged**.

### 5.2 Clipout out-edge drag

Mirror of §5.1 for `outBeatTime` / `outPoint`.

### 5.3 Clipout body translation

- Drag the clipout body in beat space; both `inBeatTime` and `outBeatTime` move by the same delta.
- `clipoutLength` is **unchanged** → BPM and beats are both unchanged.
- Any prior link on either edge breaks on movement.
- `clipin` bounds are unchanged.

### 5.4 Why direct manipulation skips the linking-event rule

Direct clipout manipulation is the user explicitly editing beat-space without reference to an anchor. The lock-respecting rule (§4.2) applies because the user has a stable region they're editing — not establishing a new link.

---

## 6. The BPM model toggle

### 6.1 The two mental models

When a user changes a region's BPM directly (via the BPM input field, not via length-change derivation), two distinct things could happen:

- **Grid model:** BPM is just a grid-density label. The clipout length stays put. Whichever of `{lockedBeats, length}` the lock says is dependent absorbs the BPM change. Beat anchors don't move. This is what the code does today.

- **Stretch model:** BPM physically scales the region's beat-space window. The clipout length rescales to preserve `lockedBeats` at the new BPM (length := `60 × lockedBeats / bpm`). Beat anchors *inside* the clipout's beat-space window scale with it (proportional rescale around `inBeatTime`).

### 6.2 Toggle setting

A per-region setting: `region.bpmModel: 'grid' | 'stretch'`, default `'grid'`.

> ⚠️ **Open question:** is this per-region (most flexible), global (simpler, less surprising), or a modifier key during BPM edit (transient)? Default proposal: per-region.

### 6.3 Cross-region anchor handling under stretch model

A single beat anchor may fall inside multiple regions' beat-space windows. If two regions are in stretch model and the user bumps one's BPM, the anchor would need to be in two places at once — a contradiction.

**Resolution:** In stretch model, only beat anchors *not* shared with another region in stretch mode are rescaled. Anchors that fall in another stretch-mode region's window are pinned and the BPM bump is rejected (with a UI hint) or is silently treated as grid model for that operation.

> ⚠️ **Open question:** the resolution above is one of several plausible choices. Alternative: stretch mode is mutually exclusive across overlapping regions (UI prevents enabling it on a region that overlaps another stretch-mode region). Needs decision before implementation.

### 6.4 Lock × bpmModel matrix on direct BPM edit

| `lock` | `bpmModel` | What changes when user sets new BPM |
|---|---|---|
| `bpm` | `grid` | (Redefines fixed BPM.) Length stays. `lockedBeats` recomputes. Anchors stay. |
| `bpm` | `stretch` | Length rescales (= 60 × lockedBeats / bpm). Anchors inside rescale. `lockedBeats` stays. |
| `beats` | `grid` | (Same as `bpm`+`grid` — lock is about *length-change response*, not BPM edit.) Length stays. `lockedBeats` recomputes. Anchors stay. |
| `beats` | `stretch` | Length rescales. Anchors inside rescale. `lockedBeats` stays. |

> ⚠️ **Open question:** in `lock='beats'` + `bpmModel='grid'`, should `lockedBeats` really recompute (overwriting the user's locked value)? Or should BPM edit be *disabled* when `lock='beats' && bpmModel='grid'` because the user said "beats are fixed" and BPM is mathematically determined?

---

## 7. Unlinking

A boundary unlinks when coincidence is broken. Possible paths:

- The user drags the input anchor off the boundary in input space → anchor moves, boundary stays → unlinked.
- The user drags the clip body / in-edge / out-edge in input space → boundary moves, anchor stays → unlinked.
- The input anchor or paired beat anchor is deleted.

**On unlink:**
- `inBeatTime`/`outBeatTime` keep their last committed values. They do **not** auto-revert to `inPoint`/`outPoint`.
- The region remains in diverged state.
- The clipout continues to display at its current beat-space coords.

### 7.1 Re-linking

If the user later re-aligns an anchor with the boundary, that's a new linking event (§3) — `inBeatTime`/`outBeatTime` is redefined from that anchor's beat time, `lockedBeats` recomputes, BPM stays.

---

## 8. Anchor independence and what BPM is *not*

In all models above:

- **Anchors are never moved by a BPM change in `bpmModel='grid'`.** They're independent objects in the warp.
- **In `bpmModel='stretch'`, anchors inside a region's beat-space window scale** — but only for that region, and only when BPM-edit is the driver.
- **Lassoing anchors and dragging them is always the explicit way to reshape the warp curve** without touching BPM/beats math. This is the "manual" path and never triggers conform / link math by itself.

---

## 9. Live preview spec (summary)

| Gesture | What updates live during drag | What commits on pointerUp |
|---|---|---|
| Anchor drag onto boundary | Clipout displays at anchor's beat time; `RegionInfoPanel` shows new `lockedBeats` (BPM stays) | §3.2 |
| Beat anchor drag while linked | Clipout edge follows anchor; lock-dependent values update | §4.2 |
| Clipout in-edge / out-edge drag | Edge follows cursor; lock-dependent values update | §5.1, §5.2 |
| Clipout body drag | Both edges translate; no value changes | `inBeatTime` & `outBeatTime` shift by delta |
| Direct BPM input edit | Live preview per §6.4 row | Same as preview |

Cancel paths (pointercancel, blur, Escape) always discard the preview and commit nothing — consistent with `drag.feature` §2.4 of `TIMELINE_BEHAVIOR.md`.

---

## 10. Lock policy summary

| Operation | Lock-respecting? |
|---|---|
| Linking event (anchor onto boundary, etc.) | **No** — always behaves like `lock='bpm'` (beats absorbs). |
| Linked-anchor move (beat anchor drag while linked) | **Yes** — lock decides. |
| Clipout in/out edge drag | **Yes** — lock decides. |
| Clipout body drag | N/A — length unchanged. |
| Direct BPM input edit | Both `lock` and `bpmModel` together decide (§6.4). |

---

## 11. Open questions (recap)

1. **§6.2** — `bpmModel`: per-region, global, or modifier-key?
  - lets start with modifier key

2. **§6.3** — Stretch-mode behavior across regions that share beat anchors: rescale only non-shared, reject the edit, or mutually-exclusive enablement?
  - just treat it normally for the active clip. shared markers need a rework soon

3. **§6.4** — `lock='beats' && bpmModel='grid'`: disable BPM edit, or let it overwrite `lockedBeats`?
  - overwwrite? this seems fine

4. **§5** — Clipout edge / body drag snap targets need explicit listing (anchors in the matching space, BPM grid in output space, other regions' edges). Largely mirrors region edge snap in `drag.feature` §6.2 but worth restating.
  - move behaviors to where they should be

5. **§7** — On anchor deletion (when linked), do we proactively revert `inBeatTime`/`outBeatTime` to `inPoint`/`outPoint`, or leave them diverged? Default proposal: leave diverged (no surprise reverts).
  - leave diverged

6. **§3** — Multi-anchor edge case: if two input anchors share the same `inputTime` (degenerate but possible?), which one's beat time does the boundary adopt? Default proposal: the first / earliest pair id.
  - sounds good

---

## 12. Implementation surface (preview, not part of design)

Changes will land mainly in:

- `src/timeline/model/conformedRegionUpdate.ts` — extend with linking-event vs linked-move branch, plus stretch-model derivation.
- `src/store/slices/regionSlice.ts` — split `applyConformedClipout` into `applyLinkingEvent` and `applyLockedConform`; add `applyBpmEdit` that branches on `bpmModel`.
- `src/timeline/controller.ts` — wire anchor-drag pointerUp at coincidence to `applyLinkingEvent`; wire clipout edge/body drag gestures (3 new gesture kinds).
- `src/components/WarpView.tsx` — replace single `onRegionResizeOutput` with the three direct-manipulation paths.
- `src/types.ts` — add `bpmModel?: 'grid' | 'stretch'` to `Region`.
- `spec/features/timeline/tracks.feature` — rewrite "Conform-driven clipout length change" scenarios per the linking-vs-linked-move distinction; add scenarios for clipout in/out/body drag and `bpmModel` toggle.
