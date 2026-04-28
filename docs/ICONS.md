# Lockstep Icon Inventory

A catalogue of every icon the app renders. Two groups:

1. **Centralized** — already exported from `src/components/icons.tsx`.
2. **Inline / not centralized** — inline `<svg>` in JSX that should eventually
   move into `icons.tsx` so the visual system stays consistent.

All icons follow the design conventions in the previous spec: 24×24 viewBox
(or 16×16 for the small toolbar variants), 1.5–2px monoline strokes,
`currentColor` so they inherit theme tokens.

---

## 1. Centralized — `src/components/icons.tsx`

### Playback
| Component | Meaning | Used in |
|---|---|---|
| `IconPlay` | Start playback | `Toolbar.tsx` |
| `IconNextFrame` | Step forward one frame | `Toolbar.tsx` |
| `IconPrevFrame` | Step back one frame | `Toolbar.tsx` |

### Markers
| Component | Meaning | Used in |
|---|---|---|
| `IconCreateMarker` | Place a marker at the playhead | `Toolbar.tsx` |
| `IconNextMarker` | Jump to next marker | `Toolbar.tsx` |
| `IconPrevMarker` | Jump to previous marker | `Toolbar.tsx` |

### Regions
| Component | Meaning | Used in |
|---|---|---|
| `IconCreateRegion` | Create a new region | `Toolbar.tsx` |
| `IconSetRegionStart` | Set region in-point at playhead | `Toolbar.tsx` |
| `IconSetRegionEnd` | Set region out-point at playhead | `Toolbar.tsx` |
| `IconGoToRegionStart` | Jump to active region's start | `Toolbar.tsx` |
| `IconGoToRegionEnd` | Jump to active region's end | `Toolbar.tsx` |
| `IconPrevRegion` | Jump to previous region (defined, not yet wired) | — |
| `IconNextRegion` | Jump to next region (defined, not yet wired) | — |

### Generic
| Component | Meaning | Used in |
|---|---|---|
| `IconDeselect` | Clear current selection | `list/ListPanel.tsx` |
| `IconTrash` | Delete row / bulk delete | `list/ListPanel.tsx`, `list/RowShell.tsx` |

---

## 2. Inline SVGs that should be added to `icons.tsx`

These are drawn directly inside JSX today. Each one is an icon used in the
chrome of the app — they belong with the centralized set.

### Playback
| Suggested name | Where it lives | Meaning |
|---|---|---|
| `IconPause` | `Toolbar.tsx` (play button, when playing) | Pause playback (two vertical bars) |

### Regions
| Suggested name | Where it lives | Meaning |
|---|---|---|
| `IconZoomToRegion` | `Toolbar.tsx` (`zoom-to-region` button) | Frame the timeline view to the active region |

### Scenes
| Suggested name | Where it lives | Meaning |
|---|---|---|
| `IconCreateScene` | `Toolbar.tsx` (`new-scene` button) | Add a manual scene-cut at the playhead |
| `IconNextScene` | `Toolbar.tsx` (`next-scene` button) | Jump to next scene-cut |
| `IconPrevScene` | `Toolbar.tsx` (`prev-scene` button) | Jump to previous scene-cut |

### Region info panel
| Suggested name | Where it lives | Meaning |
|---|---|---|
| `IconLockClosed` | `RegionInfoPanel.tsx` | BPM-lock or beat-count lock engaged |
| `IconLockOpen` | `RegionInfoPanel.tsx` | Lock disengaged |

### App chrome
| Suggested name | Where it lives | Meaning |
|---|---|---|
| `IconSettings` | `App.tsx` (top-right menubar) | Open settings dialog (gear) |
| `IconDropVideo` | `App.tsx` (drag-drop overlay) | Hint that a dropped file will be loaded (download arrow) |

### Thin-timeline toolbar (14×14, 16×16 viewBox)
| Suggested name | Where it lives | Meaning |
|---|---|---|
| `IconWarpToggle` | `thin/ThinTimeline.tsx` | Show/hide warp views (warp, marker-out, clip-out, speed) |
| `IconAlwaysAnchors` | `thin/ThinTimeline.tsx` | Always show through-lines for markers |
| `IconAlwaysRegions` | `thin/ThinTimeline.tsx` | Always show through-lines for clip / region edges |
| `IconAlwaysScenes` | `thin/ThinTimeline.tsx` | Always show through-lines for scene cuts |
| `IconThumbStrip` | `thin/ThinTimeline.tsx` | Toggle thumbnail strip on scene markers |
| `IconQueueDebug` | `thin/ThinTimeline.tsx` | Toggle thumbnail-queue debug panel |
| `IconFollowDrag` | `thin/ThinTimeline.tsx` | Playhead follows dragged markers (crosshair dot) |

---

## Style baseline (for new icons)

| Property | Value |
|---|---|
| Viewbox | `0 0 24 24` (or `0 0 16 16` for thin-timeline toolbar) |
| Stroke | `currentColor`, 2px main / 1.5px secondary |
| Fill | `none` (use `fill="currentColor"` only for solid dots / fills) |
| Linecap / linejoin | `miter` for crisp ends, `round` only when softness is intentional |
| Padding | 2px minimum from viewBox edges |
| Active state | Cyan accent (`#00E5FF`) handled via CSS, not in the SVG |

---

## Migration plan (when consolidating)

1. For each entry in §2, copy its SVG into `icons.tsx` under the suggested
   name and re-style it to match the §1 conventions (stroke widths, miter
   joins, dot fills).
2. Replace the inline `<svg>` at the call site with the new component.
3. Drop any per-component fixed `width`/`height` and rely on the `size`
   prop so the icon scales with its host button.
