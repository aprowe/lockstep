# Lockstep — Visual Design Spec

**Version:** 1.0
**Status:** Reference for color and marker design.
**Audience:** anyone tweaking timeline visuals or proposing a new theme.

This document captures the visual rules behind the timeline: principles, color
palette proposals, and the marker-shape vocabulary. It is descriptive of the
current app where shapes are concerned, and prescriptive for color choices and
new themes.

---

## 1. Design principles

Every later rule is in service of these. If a rule contradicts a principle, the
principle wins.

1. **Shape carries semantic meaning. Color carries category or state.** A user
   must be able to identify a marker type when colorblind, when zoomed out, or
   when two markers overlap. Warp anchors are circles-on-a-line, scene cuts are
   diamonds, playheads are vertical lines with a downward chevron. Don't reuse a
   shape across types.
2. **Dark, low-luminance surfaces. High-saturation accents.** The chrome
   recedes. The content (anchors, scene diamonds, regions, playhead) is what
   punches.
3. **The default (resting) state is what users see 99% of the time. Make it
   the simplest, quietest version of the element.** Hover, active, and selected
   states earn extra attention by *changing* — switching fills, adding outlines,
   thickening borders, scaling — never by piling decoration on top of the
   default. If the default already has a halo or accent ring, you have nowhere
   to escalate when state changes.
4. **Flat state, never glowing state.** State on markers, regions, and any
   element that lives *inside the timeline canvas* is communicated exclusively
   by outline weight, outline color, fill color, and scale — never by halo or
   `filter: drop-shadow`. `box-shadow` is reserved for flat *outline* rings
   (e.g. `box-shadow: 0 0 0 1px <color>` to add a hairline outside an existing
   border), or for *inset* rings; never for blurred halos. A flat 2px outline
   reads as state at any zoom level; a blurred halo washes out under busy
   backgrounds and competes with the saturated marker fills.

   Floating chrome that lives *above* the canvas (context menus, dialogs,
   dock-panel overlays) may use a soft drop shadow to communicate physical
   elevation above the surface. That's layering, not state, and is the only
   place blurred shadows are allowed.
5. **Hit targets ≥ visible glyph.** A 9–10px diamond or circle gets a 12–24px
   transparent hit zone so dragging on a dense timeline still feels accurate.
6. **Sentence case for UI text.** Tracked metadata (`MM:SS`, `BPM`, `FPS`) may
   stay uppercase as unit indicators.

---

## 2. Color palette proposals

Three palettes, each one a candidate for a new theme file under
`src/themes/`. They map onto lockstep's existing token surface (see
`src/themes/warm-dark.css` for the canonical token list — *do not invent new
top-level tokens*; pick from the existing ones).

For each palette, only the values change. The token names below are the
ones already in use.

### 2.1 Obsidian Bloom

Bitwig-leaning. Warm near-black surfaces, off-white text, warp orange against
a magenta-ish playhead.

| Token | Hex | Role |
|---|---|---|
| `--bg-0` | `#0E0E10` | App canvas / deepest layer |
| `--bg-1` | `#131315` | Main app body |
| `--bg-2` | `#1A1A1C` | Panels, tracks |
| `--bg-3` | `#1F1F22` | Sidebars, list rows |
| `--bg-4` | `#232326` | Ruler, in/out editor |
| `--bg-hover` | `#2C2C30` | Generic hover surface |
| `--border` | `#2C2C30` | Resting border |
| `--border-hi` | `#3A3A3D` | Strong border / focus |
| `--fg-1` | `#F2F2EC` | Primary text |
| `--fg-2` | `#B5B5AC` | Secondary |
| `--fg-3` | `#8A8A82` | Muted |
| `--accent` | `#FFCB2D` | Primary brand (export, active rail) |
| `--accent-2` | `#FF7A1A` | Warp / secondary |
| `--scene-cut` | `hsl(48, 95%, 62%)` | Scene-cut diamond |
| `--blue` | `#7AA5F2` | Anchor connector |
| `--error` | `#FF5A78` | Destructive |

Suggested *new* tokens this palette implies — none required, but if added give
the playhead its own theme hook:
- `--playhead: #C84BFF` — currently hardcoded as red `hsl(0, 90%, 65%)`.

### 2.2 Graphite Studio

Ableton-leaning. Flat neutral grays, high-saturation accents, white playhead.

| Token | Hex |
|---|---|
| `--bg-0` | `#1C1C1C` |
| `--bg-1` | `#222` |
| `--bg-2` | `#2A2A2A` |
| `--bg-3` | `#303030` |
| `--bg-hover` | `#3A3A3A` |
| `--border` | `#3A3A3A` |
| `--border-hi` | `#4A4A4A` |
| `--fg-1` | `#E8E8E8` |
| `--fg-2` | `#B8B8B8` |
| `--fg-3` | `#909090` |
| `--accent` | `#B6FF3D` |
| `--accent-2` | `#00C2FF` |
| `--scene-cut` | `hsl(351, 100%, 62%)` (`#FF3B5C`) |
| `--blue` | `#00C2FF` |
| `--error` | `#FF3B5C` |

Suggested playhead: `#FFFFFF`.

### 2.3 Signal Noir

Premiere/After Effects DNA. Slightly blue-tinted blacks, jewel-tone accents.

| Token | Hex |
|---|---|
| `--bg-0` | `#131318` |
| `--bg-1` | `#181820` |
| `--bg-2` | `#1F1F22` |
| `--bg-3` | `#252529` |
| `--bg-hover` | `#2E2E33` |
| `--border` | `#2E2E33` |
| `--border-hi` | `#3E3E44` |
| `--fg-1` | `#EDEDF0` |
| `--fg-2` | `#B5B5BC` |
| `--fg-3` | `#8E8E96` |
| `--accent` | `#F5C518` |
| `--accent-2` | `#5B8DEF` |
| `--scene-cut` | `hsl(338, 79%, 60%)` (`#E94B7A`) |
| `--blue` | `#5B8DEF` |
| `--error` | `#E94B7A` |

Suggested playhead: `#F5C518`.

### 2.4 Picking accent assignments

Lockstep already separates four accent roles, so map each palette accordingly:

- `--accent` — primary brand color. Used by Export buttons, the active rail,
  region selection outlines.
- `--accent-2` — secondary. Used for the warp connector, anchor highlights.
- `--scene-cut` — scene-cut diamonds (yellow by default). Should always read as
  a *warning-ish* hue distinct from `--accent` and `--accent-2`.
- The clip-region palette (`.clip-overlay--color-0..7` in `src/index.css`) is
  intentionally a separate hue ramp and stays scheme-independent — those eight
  hues distinguish regions from one another, not from the chrome.

---

## 3. Structural tokens

The non-color tokens already live in `src/index.css` under `:root`. Reference
those — do not introduce parallel `--font-size-*`, `--space-*`, or
`--radius-*` tokens.

- **Type:** `--t-2xs` (9px) … `--t-2xl` (18px), all multiplied by `--ui-scale`.
  Use `--font-family` (theme-controlled mono).
- **Spacing:** `--sp-0` (2px) … `--sp-9` (48px).
- **Component sizes:** `--sz-track`, `--sz-ruler`, `--sz-minimap`,
  `--sz-connector`, `--sz-rail`, `--sz-btn*`, etc.

When adding a marker or row, build height from `--sz-*` and padding from
`--sp-*` so the whole UI continues to scale with `--ui-scale`.

---

## 4. Marker shape vocabulary

Five marker primitives appear on the timeline. Geometry is **invariant**;
color tracks the active theme.

### 4.1 Warp anchor — circle on a line

**Use:** anchor point that locks a source frame to an output time.
**Geometry:** 10px-diameter circle centered on the anchor's x position, with a
1.5px vertical line through it spanning the row height.
**Color:** `--space-input` for input-space rows (the cyan in warm-dark),
`--space-output` for output-space rows. The connector between rows uses
`--accent-2`.
**Implementation:** `.thin-marker` in `src/components/thin/MarkersTrack.css`.

| State | Visual |
|---|---|
| Default | Solid circle + 1.5px stem (no border ring) |
| Hover | Brighter fill, 2px stem |
| Selected | Yellow fill (`hsl(48, 100%, 70%)`), 2px stem, 1.15× scale |

### 4.2 Scene cut — diamond

**Use:** detected or user-placed scene boundary on the scene band.
**Geometry:** 9×9px square rotated 45°.
**Color:** `--scene-cut` family (`--scene-cut`, `--scene-cut-hi`,
`--scene-cut-bd`, `--scene-cut-active`, `--scene-cut-active-bd`).
**Implementation:** `.scene-band__diamond` in `src/components/SceneRow.css`.

| State | Visual |
|---|---|
| Default | Solid fill, 1px border |
| Hover | Brighter fill |
| Active (current scene) | Lifted fill (`--scene-cut-active`) + brighter border (`--scene-cut-active-bd`), 1.25× scale |
| User-placed | Same hue + inset 1px hairline ring (subtle origin marker) |
| Selected (lasso) | 1px cyan outline ring outside the diamond — coexists with active state |

The faint horizontal wash behind the diamonds (`.scene-band__scanned`) marks
spans that have been analyzed; keep it under 10% alpha so it never competes
with the diamonds.

### 4.3 Playhead — vertical line + downward chevron

**Use:** current playback / scrub position. Spans the full timeline height.
**Geometry:** 1–2px vertical line, capped by a downward triangle (5px half-base
× 7px tall) sitting in the time ruler.
**Color:** currently `hsl(0, 90%, 65%)` (red), hardcoded. If introducing a
`--playhead` token, that's the single hook to switch.
**Implementation:** `.thin-timeline__playhead*` in
`src/components/thin/ThinTimeline.css`.

| Variant | Visual |
|---|---|
| Thick (active timeline) | 2px solid line |
| Thin (peer timelines) | 1px line at 0.85 alpha |
| Hover (preview) | 1px line at `--fg-4` 0.5 alpha (separate `.thin-timeline__hover` element) |

The chevron is a flat CSS triangle (border trick) — no drop-shadow filter.
The 2px width on the active timeline (vs 1px on peers) is the only state
indicator; rely on the saturated color of `--playhead` against the dark
ground for legibility, not a halo. The playhead must always render above
markers — z-index 5–6, above the marker z-index 4.

### 4.4 Bar / beat tick — thin vertical line

**Use:** beat-grid divisions on the bars track.
**Geometry:** 1–2px vertical line, full row height minus 4px top/bottom.
**Color:** `--fg-4` (minor), `--fg-2` (major bar).
**Implementation:** `.thin-bar` / `.thin-bar--major` in
`src/components/thin/BarsTrack.css`.

Bars are deliberately the quietest marker type — there are dozens per region.
Major bars get a label using `--font-family` at 9px, color `--fg-1`,
weight 500.

### 4.5 Region overlay — colored block

**Use:** a clip / sub-region with its own in/out, BPM, and lock mode.
**Geometry:** full-row rectangle from `inPoint` to `outPoint`, with two
invisible 6px edge handles for resize.
**Color:** per-region hue from `.clip-overlay--color-0..7` (8-color HSL ramp
in `src/index.css`). Input-space rows use the base lightness; output-space
rows darken the lightness by 18% so the two bands stay distinguishable when
both are filled.
**Implementation:** `.thin-region` in `src/components/thin/RegionBand.css`.

| State | Visual |
|---|---|
| Default | 0.78-alpha fill, 1px 0.95-alpha border |
| Hover | `filter: brightness(1.15)` |
| Active | 2px yellow border `hsl(48, 100%, 78%)` (thicker than default — no glow) |
| Selected (lasso) | 2px `--accent` outline, inset offset |
| Edge handle hover | Faint yellow wash + inset 1px ring |

Region labels are white, weight 600, with a layered text-shadow (1px halo +
3px drop). The label hard-clips at the region edge — no ellipsis — so the
visible portion always reads as the start of the real name.

### 4.6 Hit targets

- Warp anchor: 12px-wide button hit zone (4.1) — a 24px target if the row is
  ≥ 24px tall. Acceptable on the current 14–18px-tall thin rows; widen if
  rows shrink further.
- Scene diamond: glyph is 9px, hit zone matches the parent
  `.scene-band__marker` flex column inside an 18–66px-tall band.
- Region edge handle: 6px wide, dedicated `cursor: ew-resize`.
- Playhead chevron: 10px-wide triangle, drag-handle behavior.

---

## 5. Component rules

### 5.1 Thin timeline rows

- Row background: `--bg-2` or `--bg-3` depending on space (input / output).
- Inter-row separator: 1px line at `--border` (lockstep uses 1px borders
  consistently — keep that for visual continuity with the rest of the app).
- Row body uses `cursor: copy` when clicks place new markers (markers track,
  scene band) and `cursor: pointer`/`grab` over interactive children.
- The active timeline gets the thick playhead; inactive timelines get the
  thin playhead so the current focus is unambiguous.

### 5.2 Ruler (time / bars)

- Height: `--sz-ruler` (28px scaled).
- Background: `--bg-4`.
- Major tick: 1–2px line at `--fg-2`.
- Minor tick: 1px line at `--fg-4` 0.7 alpha.
- Tick labels: `--font-family`, 9px, color `--fg-3` (minor) or `--fg-1`
  (major). Format: `MM:SS` or `MM:SS.fff` zoomed in past ~1s/100px.

### 5.3 Region rendering

- Regions sit at z-index below markers and the playhead, so anchor circles and
  the playhead always paint over the region fill.
- During drag, no transition — track the cursor frame-perfectly. Hover
  brightness uses an 80ms transition.
- The output-space band uses the same hue darkened by 18% lightness so the
  two bands read as the same region without merging visually.

### 5.4 Warp connector

- Sits between input and output marker rows in the warp stack. Height
  `--sz-connector` (26px), background `--bg-0`.
- Connector strokes use `--blue` at 0.65 stroke-opacity for in-range
  segments. Out-of-range regions are darkened by a 0.45-alpha black overlay.
- When empty (no anchors), draw dashed top/bottom borders at `--bg-4` to
  preserve the row's footprint.

### 5.5 Selection vs. active vs. highlight

Three orthogonal states, never collapsed into one:

- **Active** — the *current* item (current scene, active region). Uses a
  brighter fill and a thicker (or differently-colored) border. No glow.
- **Selected** — member of the lasso/list selection. Uses a flat 1–2px outer
  outline ring so it stacks on top of an active fill without sharing the
  same visual register.
- **Hover** — transient. Brighten fill, ≤ 80ms transition. No outline change.

A scene diamond can be selected *and* active simultaneously: the active fill
+ active border live on the diamond itself, the selected ring sits outside
it. They coexist because they live at different radii — no glow, no overlap.

### 5.6 Tooltips

- Background: `--bg-hover` or `--bg-5`.
- Border: 1px `--border-hi`.
- Padding: `--sp-2 --sp-3`.
- Text: 11px `--fg-1` for value, `--fg-2` for label.
- Appearance delay: 400ms hover; instant dismiss; offset 8px from cursor;
  never overlap the marker described.

---

## 6. Iconography

- Stroke icons preferred for chrome (toolbar, menu bar). 1.5px stroke, 16px
  default size.
- Icon color: `--fg-2` resting, `--fg-1` on hover/active.
- No emoji in chrome.

---

## 7. States summary

| State | Visual change |
|---|---|
| Default | Per §4 / §5 |
| Hover | Background → `--bg-hover` (chrome) or `filter: brightness(1.15)` (regions); 80ms transition |
| Active (pressed) | Slight scale-down (0.9–0.98), no transition |
| Selected | Per-marker rule in §4 — usually an outer ring on top of any active fill |
| Disabled | 40% opacity, `cursor: not-allowed` |
| Focus (keyboard) | 1px outline at `--accent-2`, 1px offset |

---

## 8. Accessibility

- Every marker exposes its type and timestamp via `aria-label` —
  `"Warp anchor at 00:14.230"`, `"Scene cut at 01:02.000, user-placed"`.
- Keyboard nav: arrow keys scrub the playhead, shift+arrow by larger steps,
  tab cycles markers in time order. (See `src/hotkeys.ts` for the canonical
  binding map.)
- Color is **never** the only indicator of state — shape, fill mode, and
  outline rings encode state per §4.
- Verify text contrast against the chosen surface, especially `--fg-3`/`--fg-4`
  on `--bg-2`. WCAG AA is the floor for text; UI markers may go below if
  shape disambiguates.
- `prefers-reduced-motion: reduce` should disable any pulse / brightness
  oscillation. Hold at the resting state.

---

## 9. Out of scope for this spec

- Light-mode variants of the palettes.
- User-customizable accent colors (theme is global, not per-marker).
- Marker glyph types beyond the five in §4.
- Export-dialog and modal styling — those follow the panel surface tokens
  but aren't normative here.
