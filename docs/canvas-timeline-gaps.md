# CanvasTimeline → ThinTimeline Gap List

Gaps found by reading both components in full. Work through in priority order.

---

## Critical — behavioral gaps

- [x] **1. No keyboard handling.**
- [x] **2. No lasso selection.**
- [x] **3. Empty click doesn't deselect.**
- [x] **4. Shift+wheel = pan not handled.**

---

## Visual gaps — props received but not rendered

- [x] **5. `selectedAnchorIds` unused.** Anchors don't visually distinguish selected vs unselected.

- [x] **6. `userSceneTimes` unused.** User-placed scenes should render with a cooler hue vs auto-detected ones.

- [x] **7. `scannedRanges` unused.** Should shade already-scanned ranges in the scenes track.

- [x] **8. `linkedBeatIds` unused.** Beat anchors not in this set should render hollow/outlined.

- [ ] **9. Thumbnails never drawn.** Defer.

---

## Through-line gaps

- [x] **10. Scene through-lines missing.** Should draw on hover, when selected, and when alwaysScenes is on.

- [x] **11. Beat through-lines only in beat ruler.** Should span full output section (markerout → beat, stopping before speed).

- [x] **12. Region through-lines stop at warp boundary.** Should slant through the warp zone.

---

## Snap gap

- [x] **13. Region resize/move doesn't snap.**

---

## UX / polish (from user feedback)

- [x] **14. Cursor not changing.** Should use ew-resize on resize handles, grab on anchors/regions, grabbing while dragging.

- [x] **15. Color theming.** Hardcoded hex values; should read from CSS variables via getComputedStyle.

- [x] **16. Lasso should fill tracks** not be free-form — expand Y range to cover full height of touched tracks.

- [x] **17. Clip resize edges too bold.** 4px handles too prominent; reduce to 2px, lower lightness boost.

---

## Lower priority / canvas-native (fine to defer)

- Row resize grips — canvas tracks auto-expand instead
- Hover frames dispatch (`setHoverFrames`) for thumbnail preloading
- WarpConnector segment selection
