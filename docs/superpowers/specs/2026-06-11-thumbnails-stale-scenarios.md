# Thumbnails — Stale Behavior Scenarios (post-redo hand-off)

**Date:** 2026-06-11
**Context:** The thumbnail system redo (commit `5fb10eb`) replaced priority-by-position
with reason-aware wants (`ThumbnailReason` + tier-based scheduling). `spec/features/thumbnails.feature`
predates that change. Per the project rule, `spec/` is not edited without explicit approval —
this report surfaces the scenarios that need your decision.

## New model, for reference

Frames are wanted by **reason**, and reason maps to a priority tier:

| Tier | Reasons | Retainer |
|---|---|---|
| 0 (highest) | `clip-hover`, `scene-hover`, `anchor-hover` | Static (uncapped) |
| 1 | `filmstrip` (frames around the playhead) | Dynamic (LRU capped) |
| 2 | `anchors`, `clips` (one frame per region `inPoint`) | Static |
| 3 (background) | `scenes` (one frame per scene cut) | Static |

There is no "region interior" reason and no spatial "near the playhead" ordering —
proximity is expressed indirectly: the filmstrip *requests* frames around the playhead,
and filmstrip is tier 1.

## Scenario-by-scenario

| # | Scenario | Verdict | Notes |
|---|----------|---------|-------|
| 1 | Thumbnails start generating when a video loads | ✅ **Still valid** | Loading a video populates wants → background decode starts. Needs a `@behavior` marker on a covering test. |
| 2 | Thumbnails near the playhead are generated first | ⚠️ **Reword** | Mechanism changed: playhead frames are requested via the `filmstrip` reason (tier 1), which outranks `clips`/`anchors`/`scenes`. True in spirit, but "near the playhead" should become "frames requested by the filmstrip (tier 1) are decoded before scene/clip/anchor frames." |
| 3 | Thumbnails inside a region are generated first | ❌ **Obsolete** | No "region interior" concept survives. A region contributes a single thumbnail at its `inPoint` via the `clips` reason (tier 2) — it is *not* prioritized above the filmstrip, and interior frames are not bulk-requested. Recommend deleting or rewriting to "a region contributes one thumbnail at its in-point." |
| 4 | Scrubbing the input ruler updates the thumbnail viewer | ✅ **Still valid** | Filmstrip recenters on the playhead; surrounding slots fill as decoded. Needs marker. |
| 5 | Filmstrip center slot equals the toolbar frame counter | ✅ **Still valid** | Float-safe frame conversion in `Filmstrip.tsx` is unchanged. Needs marker. |
| 6 | Missing thumbnails show a placeholder | ✅ **Still valid** | `<Thumbnail />` renders a placeholder until `thumbnail-ready`. Directly covered by `tests/unit/components/Thumbnail.test.tsx` — just needs the `@behavior` marker. |
| 7 | Hovering a scene marker shows a thumbnail popup | ✅ **Still valid** | `scene-hover` reason (tier 0) + `ThumbnailPopup`. Needs marker. |
| 8 | Expanded scene strip shows one thumbnail per marker | ✅ **Still valid** | `scenes` reason renders inline per `SceneRow`. Needs marker. |

## Summary

- **Obsolete (delete or rewrite):** #3 (region-interior priority).
- **Reword (mechanism changed, intent intact):** #2 (playhead-proximity → filmstrip tier).
- **Valid, needs `@behavior` markers only:** #1, #4, #5, #6, #7, #8.

None of the current thumbnail tests carry `@behavior` markers yet, so even the valid scenarios
read as uncovered in the coverage gate. Adding markers to the existing tests closes 6 of 8;
#2 and #3 need your call on the feature text first.
