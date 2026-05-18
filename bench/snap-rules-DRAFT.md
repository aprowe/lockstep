# Snap rules draft

Fill in the tables below. I'll convert it into `src/constraints/snap-rules.ts` with the typed table and a mirror that emits the `SnapCohort` / `SnapRule` constraints from it.

Legend:
- `Y` — yes, snap.
- `—` — no.
- `?` — unsure / discuss.
- For conditional cases, write a short note in the cell (e.g. `Y (lockMode=bpm)` or `Y if alt held`).

---

## 1. Cohorts (entities that share a snap identity)

Add / remove rows as needed. The "Maintained by" column is just a sketch — I'll wire each mirror after the table's filled.

| Cohort tag | What's in it | Maintained by |
|---|---|---|
| `anchor-in` | every `a*-in` entity | spaceGroupMirror |
| `anchor-out` | every `a*-out` entity | spaceGroupMirror |
| `clipin` | every `r*-in` entity | spaceGroupMirror |
| `clipout` | every `r*-out` entity | spaceGroupMirror |
| `scenes` | scene-cut entities | sceneGroupMirror |
| `twin:{regionId}` | `[r{id}-in, r{id}-out]` per region | twinGroupMirror |
| `playhead` | the playhead entity | playheadGroupMirror |
| `grid` | beat-grid marks (synthetic; install-time only) | (built into snapToSiblings install) |

Anything missing? Add rows above this line.

---

## 2. Drag rolesplit (cohorts that need edge vs body distinction)

For clip drags, "edge" (resize) and "body" (pan) usually want different rule sets. Fill `Y` if you want the cohort split into role-aware variants.

| Cohort | Split into edge/body? | Notes |
|---|---|---|
| `clipin` |N| |
| `clipout` |Y| |
| `anchor-in` | (anchors only have one drag mode — leave blank) | |
| `anchor-out` | (same) | |

If you mark a clip cohort as split, the rules table below should use `clipin:edge` / `clipin:body` instead of just `clipin`.

---

## 3. Rules (dragger ↓ → target →)

Mark each cell. Empty = no rule = explicit "no snap." This is the main thing.

> If you split `clipin` / `clipout` above, duplicate the row for each subcohort.

| Dragger ↓ \ Target → | anchor-in | anchor-out | clipin | clipout | scenes | twin (own region) | playhead | grid |
|---|---|---|---|---|---|---|---|---|
| **anchor-in** | anchor in, anchor out, clip in, scenes, playhead
| **anchor-out** | anchor in, clip out, playhead (warped can add later), grid
| **clipin** | anchor in, scene, clipout, playhead, (grid when default-linked)
| **clipout** | twin, grid when resizing bpm-locked
| **playhead** |none

---

## 4. Conditional rules

For any `Y (condition)` you wrote above, list the condition here in plain English. I'll either fold it into the mirror (config-driven add/remove of the rule) or into the recipe (install-time check).

- e.g. **clipout:edge → grid:** only when `lockMode === 'bpm'` (otherwise grid is in motion).
- e.g. **(your rule):**
- e.g. **(your rule):**

---

## 5. Out-of-scope notes

Anything you want to flag for later but not implement now:

- e.g. user-config toggle to disable anchor↔anchor snap.
- e.g.


# Notes
Just pay attention to the grid changing snapping
for ease, when its grid changing only out-space snap to its twin

When a region is default linked, changing clip in changes the grid, but it only snaps to in-space targets
