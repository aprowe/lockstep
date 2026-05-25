# Scene Thumbnail Track

A new row on the canvas timeline that renders a thumbnail image at each detected scene cut. Click-to-seek; no other interaction in this pass.

## Branch

`thumbnail-track` off `main`.

## Layout

Add one row to `src/timeline/layout.ts:ALL_TRACKS`, immediately after `scenes`:

```ts
{ id: "scene-thumbs", label: "Scene Thumbnails", h: 40, space: "input", flex: 0 }
```

- Height: 40 px (≈ 71 px wide thumbnail at 16:9).
- `flex: 0` — does not grow when the user resizes the timeline; matches the other strip rows (`scenes`, `speed`, `clipout`).
- Space: `"input"` — same coordinate space as the scene diamonds it pairs with.

No changes to `buildLayout`; the existing flex/override logic handles the new track unchanged.

## Data sources

No new Redux state. The track consumes existing data:

- **Scene times** — `props.scenes: number[]` (already passed to `CanvasTimeline` from `WarpView`).
- **Video metadata** — needs `fps`, `width`, `height`, `fileHash` from `state.video.video`. Currently `CanvasTimeline` does not receive these; `WarpView` will pass them in as new props (`videoFps`, `videoAspect`, `videoFileHash`).
- **Thumbnail paths** — `selectThumbnailPathsFor(fileHash)` from `src/store/slices/thumbnailsSlice.ts`. Already populated by `Filmstrip`'s `thumbnail-ready` listener. `WarpView` selects this and passes it down as `thumbPaths: Record<number, string>`.

### Backend queue (no changes)

`setThumbnailPriority` already accepts `sceneFrames` and ranks them as a priority tier. Because `Filmstrip` already pushes the visible-scenes set, scene thumbnails for the loaded video will be generated without any change to the priority push. The new track is a pure consumer of the existing cache.

If `Filmstrip` is unmounted (none of the layouts currently do this, but worth knowing), scene thumbnails would stop being prioritized. This is acceptable for the first pass — out of scope to duplicate the priority push.

## Image cache

Canvas drawing is synchronous; thumbnail paths resolve to disk URLs that have to be loaded into `HTMLImageElement`s before they can be drawn. `CanvasTimeline` owns a small cache:

```ts
const imageCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
```

For each scene-thumbnail draw call where `thumbPaths[frame]` is known:

1. If the cache has a loaded image for `frame`, draw it.
2. If not, construct `new Image()`, set `src = convertFileSrc(thumbPaths[frame])`, store in the cache, and attach an `onload` handler that calls `drawRef.current()`. Draw a placeholder for this frame in the current pass.
3. If `thumbPaths[frame]` is undefined (thumbnail not yet generated), draw a placeholder.

Eviction: a `useEffect` keyed on the active scene set clears cache entries whose frame is no longer in the visible scene list. Bounded by the scene count (typically tens to hundreds), so no LRU is needed.

## Render

New helper `layerSceneThumbnails()` inside `CanvasTimeline.draw`, placed after `layerScenes`:

```text
for each scene time t (sorted ascending):
    x = round(tX(t))
    skip if x + thumbW < 0 or x > W
    thumbW = round(trackH × videoAspect)
    nextX = sorted next scene's tX (or +∞)
    if nextX - x < thumbW:
        skip (would overlap the next thumbnail)
    img = cache.get(frame(t))
    if img && img.complete:
        drawImage(img, x, tr.y, thumbW, tr.h)
    else:
        fill bg2, stroke border (1 px)
        if path is known but img not loaded: kick off load
    addHit(x, tr.y, thumbW, tr.h, { kind: "scene-thumb", time: t })
```

- `frame(t)` = `Math.round(t × videoFps)`, matching how `Filmstrip` derives scene frames.
- Left edge of each thumbnail sits exactly on the scene cut's x. The visual contract is "the first frame after this cut."
- Overlap rule: if the next scene cut is closer than one thumbnail width, hide the earlier thumbnail (skipping the later one would leave a gap right before a cut, which reads worse). This is iteration-1 behaviour — refinement is out of scope.
- Theme colors come from `themeRef.current` (`bg2`, `border`) just like other layers.

## Interaction

Existing pattern: hit-test data with a `kind` discriminator is added to `hitsBuilderRef`; the controller dispatches by `kind` on pointer events.

For `{ kind: "scene-thumb", time }`:

- Pointer-down → `props.onSeek?.(time)` (same callback the minimap already uses).
- Pointer-move while hovering → set cursor to `pointer` (already handled generically by the controller's hover-cursor logic for clickable kinds; verify and add this kind to the list if needed).
- No selection, no drag, no context menu in this pass.

Implementation: add a branch in `src/timeline/controller.ts` where other simple seek-style hits are handled (the `minimap` and `time` ruler handlers are the closest analogues). If they delegate via a callback rather than emitting an intent, follow the same pattern for `scene-thumb`.

## Threading the video info

`WarpView` already selects `state.video.video`. Add three derived values to its render and pass as props to `<CanvasTimeline>`:

```ts
const videoFps = video?.fps ?? 0;
const videoAspect = video && video.height > 0 ? video.width / video.height : 16 / 9;
const videoFileHash = video?.fileHash;
const thumbPaths = useAppSelector(selectThumbnailPathsFor(videoFileHash));
```

Add corresponding optional props to `CanvasTimelineProps`. The track renders nothing (skips its entire layer) when `videoFps <= 0` or no scenes exist, so the row is empty but still occupies its 40 px (consistent with how `clipout` behaves when there are no regions).

## Tests

Unit tests in `tests/unit/`:

1. **Layout** — `buildLayout` includes the `scene-thumbs` track with `h: 40` immediately after `scenes`, in both expanded and warp-collapsed modes (it lives in input space, so the collapse filter keeps it).
2. **Overlap culling** — pure helper extracted from `layerSceneThumbnails` (a function that takes scene xs, thumbW, viewport W and returns the visible subset) is unit-tested for: non-overlapping scenes all visible; overlapping pair drops the earlier one; off-screen scenes excluded.
3. **Click-to-seek** — render `CanvasTimeline` with one scene, click within the thumb's hit box, assert `onSeek` called with the scene time.

No new BDD feature in `spec/` (per CLAUDE.md, don't edit `spec/` unless asked).

## Out of scope

- Hover preview popups (the existing `ThumbnailPopup`/`useSetThumbnailHover` could be wired later).
- Drag-to-rearrange / drag-to-seek.
- Thumbnail variants pinned to other markers (anchors, region edges).
- User-configurable track height or thumbnail width.
- A custom backend priority push for scenes when `Filmstrip` is unmounted.
- Loading-spinner UI inside the placeholder (plain rect is fine for v1).
