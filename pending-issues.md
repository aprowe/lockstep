# Pending GitHub Issues

Drafts to file via `gh issue create` once connectivity is back.

---

## Playback: loop options (stop / loop / continue)

Add a playback behavior selector controlling what happens when the playhead reaches the end of the active clip / region. Three modes:

- **Stop at end of clip** — pause at the clip's out-point
- **Loop clip** — seek back to in-point and keep playing
- **Continue** — current default, roll past the out-point

### Notes

- State lives on the active region (or globally if no region is active)
- UI: small split toggle near the play controls in the bottom toolbar (consistent with existing `tb-group--center` placement)
- Keep separate from existing `trimToLoop` / `loopBeats` export options — those are export-time, this is playback-time

---

## Toolbar: BPM-detect icon

Add an icon-button to the toolbar that triggers BPM auto-detect on the active clip's audio. Currently BPM is set manually or estimated via tap. Surface a one-click detect action with a clear icon (e.g. metronome + ✨/auto badge).

### Notes

- Lives in the create or in/out cluster of the bottom toolbar
- Uses the regions red hue since BPM is a per-region property

---

## Tap tempo

Add a tap-tempo control: the user taps a key (or button) in time with the music; the app averages tap intervals to set the active region's BPM. Should clear after a short idle window so a new tap-set starts fresh. Keep the result tunable via the existing BPM input.

### Notes

- Hotkey suggestion: `T`
- Toolbar surface: same cluster as BPM-detect

---

## Naming: unify "clip" vs "region"

The codebase uses both terms interchangeably for the same concept (a named sub-clip of a video with its own in/out + BPM). Examples of the split today:

- **Region**: `regionSlice`, `RegionBand`, `RegionInfoPanel`, `Region` type, `addRegion`, `activeRegionId`, `tb-btn--region`, `tb-btn--nav-region`, "New region" tooltip
- **Clip**: `ClipSidebar`, `ClipsPanel`, `clipOverlay`, `selectedClipSet`, `clipBeatCount` (recently renamed away), `--clip-h/s/l` palette, "active clip" copy

### Decision needed

Pick one canonical term and rename across:

- Redux slice + actions
- Component names + CSS classes
- Type names
- User-facing copy (tooltips, menu labels, dialogs)
- Tests + spec/feature files

### Notes

- "Clip" reads as the more common NLE term; "region" is more DAW-y
- Watch out for `Region` overlapping with browser/DOM `Region` semantics if we go that way
- Coordinate with `spec/` files since several feature names hard-code "region"

---

## Export: encoding options

Expose codec / quality controls in the export dialog instead of relying on the hardcoded ffmpeg defaults in `processor.rs`. At minimum:

- **Video codec** — H.264 / H.265 / ProRes
- **Quality** — CRF slider (or preset: low / medium / high) for x264/x265, profile selector for ProRes
- **Audio** — bitrate selector (128 / 192 / 320 kbps) or "copy"
- **Container** — mp4 / mov

### Notes

- UI lives in `ExportDialog.tsx` under a collapsible "Encoding" section so the default flow stays one-click
- Plumb settings through `start_warp` args → `remap_video()` in `processor.rs`
- Persist last-used choices in `uiSlice` so batch exports remember them
- Watch out for atempo/concat compatibility: ProRes + concat demuxer needs matching streams

---

## Preview tab

Add a preview mode that renders the warped output in real time (or near-real-time) without going through full export. Lets the user audition a region's BPM/anchor settings against the music before committing to an export.

### Notes

- Two possible implementations:
  - **Cheap**: client-side `playbackRate` modulation driven by the same time-map used by `remap_video()` — no audio time-stretch, but instant feedback
  - **Better**: short ffmpeg render to a temp file (a few seconds around the playhead) and swap in
- UI: tab/toggle in the main view next to the timeline, or a "Preview" button in `RegionInfoPanel`
- Should respect the active region's in/out and beat zero
- Audio pitch handling needs a decision — for the cheap path, pitch shifts with rate; for the ffmpeg path, atempo preserves pitch

---

## Speed curve

Support non-linear speed curves within a region as an alternative to anchor-based warping. User draws a curve (speed multiplier vs. time) and the warp pipeline integrates it to produce the time map.

### Notes

- New region mode: `lock: 'curve'` (alongside existing BPM/beat-count locks), or a separate `curveMap` field on `Region`
- Curve editor UI: bezier or piecewise-linear handles overlaid on the timeline within the region's in/out
- Pipeline: convert curve → dense `direct_time_map` samples → feed into the existing segment/setpts path in `processor.rs` (may need finer slicing than current anchor-based approach)
- Audio with continuously varying rate is harder than discrete segments — atempo per segment works but introduces seams; investigate `rubberband` filter as an alternative
- Persist curves in the same sidecar JSON as anchors/regions
