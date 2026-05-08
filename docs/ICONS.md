# Lockstep Icon Glossary

All icons used or needed in the app, grouped by area. For each icon, the name corresponds to the component in `icons.tsx` (if it exists) and the description explains what the icon should communicate — not what it looks like.

---

## Playback Controls

| Component | Meaning |
|---|---|
| `IconPlay` | Start playback from the current position |
| `IconPause` | Suspend playback, holding the current position |
| `IconPrevFrame` | Step backward exactly one video frame |
| `IconNextFrame` | Step forward exactly one video frame |
| `IconStop` | Stop playback and return to the beginning |

---

## Playback Loop Modes

Three mutually exclusive states for what happens when playback reaches a boundary (end of clip, region, or video).

| Component | Meaning |
|---|---|
| `IconLoopStop` | Pause at the boundary; playback ends there |
| `IconLoopRepeat` | Wrap from the end back to the start and keep playing |
| `IconLoopContinue` | Continue playing past the boundary into whatever comes next |

---

## Markers

Markers are single time-point flags on the timeline.

| Component | Meaning |
|---|---|
| `IconCreateMarker` | Place a new marker at the current playhead position |
| `IconPrevMarker` | Move the playhead to the nearest marker before the current position |
| `IconNextMarker` | Move the playhead to the nearest marker after the current position |
| *(needed)* `IconDeleteMarker` | Remove the currently selected or hovered marker |
| *(needed)* `IconSnapMarker` | Snap a marker to the nearest beat |
| *(needed)* `IconResetMarker` | Clear a marker's beat override and restore its default beat mapping |
| *(needed)* `IconImportMarkers` | Import marker timecodes from a JSON file |

---

## Regions

Regions are named sub-clips with in/out points and their own BPM settings.

| Component | Meaning |
|---|---|
| `IconCreateRegion` | Create a new region spanning a default range |
| `IconSetRegionStart` | Move the active region's in-point to the current playhead position |
| `IconSetRegionEnd` | Move the active region's out-point to the current playhead position |
| `IconGoToRegionStart` | Jump the playhead to the active region's in-point |
| `IconGoToRegionEnd` | Jump the playhead to the active region's out-point |
| `IconPrevRegion` | Select and jump to the region that comes before the active one |
| `IconNextRegion` | Select and jump to the region that comes after the active one |
| `IconZoomToRegion` | Zoom the timeline view so the active region fills the visible window |
| `IconDeselect` | Clear the active region selection, returning to the global/whole-video view |
| *(needed)* `IconRenameRegion` | Rename the active region |
| *(needed)* `IconDuplicateRegion` | Create a copy of the active region |

---

## Scenes

Scene markers divide the video into named sections independent of regions.

| Component | Meaning |
|---|---|
| `IconCreateScene` | Place a new scene marker at the current playhead position |
| `IconPrevScene` | Jump the playhead to the previous scene marker |
| `IconNextScene` | Jump the playhead to the next scene marker |
| *(needed)* `IconDeleteScene` | Remove the current or selected scene marker |
| *(needed)* `IconSeekToScene` | Jump playback to a specific scene's start |

---

## BPM / Beat Locking

Used in the Region Info Panel to control whether BPM or beat count stays fixed when region boundaries change.

| Component | Meaning |
|---|---|
| `IconLockClosed` | The value (BPM or beat count) is locked; changes to boundaries won't affect it |
| `IconLockOpen` | The value is unlocked and will recompute when boundaries change |

---

## Timeline Toolbar Toggles

Small toggle buttons in the thin timeline's right-side toolbar. Each controls a display or behavior option for the timeline.

| Component | Meaning |
|---|---|
| `IconWarpToggle` | Show or hide the warp/time-stretch overlay on the timeline |
| `IconThumbStrip` | Show or hide the thumbnail filmstrip beneath the timeline |
| `IconAlwaysAnchors` | Pin anchor markers visible at all zoom levels instead of fading them out |
| `IconAlwaysRegions` | Pin region overlays visible at all zoom levels |
| `IconAlwaysScenes` | Pin scene markers visible at all zoom levels |
| `IconFollowDrag` | When enabled, the timeline scrolls to keep the playhead centered during playback or drag |
| `IconQueueDebug` | Open the thumbnail generation queue debug panel |

---

## File & Folder Operations

| Component | Meaning |
|---|---|
| `IconDropVideo` | Empty-state prompt: indicates where a user can drop or open a video file |
| *(needed)* `IconOpenFolder` | Browse for and open a folder in the sidebar |
| *(needed)* `IconOpenFile` | Open a single video file via the native file picker |
| *(needed)* `IconRevealInFinder` | Show a file or folder in the OS file manager |
| *(needed)* `IconExport` | Open the export dialog or trigger an export operation |
| *(needed)* `IconSave` | Save the current output or state to disk |
| *(needed)* `IconBrowse` | Open a folder picker (used in export destination fields) |

---

## Destructive / Edit Actions

| Component | Meaning |
|---|---|
| `IconTrash` | Permanently delete the selected item (region, marker, scene, etc.) |
| `IconRename` | Begin editing the name of the selected item inline |
| *(needed)* `IconClearAll` | Remove all items of a type at once (e.g., clear all markers) |
| `IconUndo` | Revert the most recent action |
| `IconRedo` | Reapply the most recently undone action |

---

## Settings & App Chrome

| Component | Meaning |
|---|---|
| `IconSettings` | Open the settings/preferences dialog |
| *(needed)* `IconClose` | Dismiss a dialog, panel, or overlay |
| *(needed)* `IconMinimize` | Minimize the window to the taskbar/dock |
| *(needed)* `IconMaximize` | Expand the window to fill the screen |
| *(needed)* `IconRestore` | Return the window from maximized to its previous size |
| *(needed)* `IconVisibility` | Toggle visibility of a sensitive value (e.g., show/hide an API key) |
| *(needed)* `IconReset` | Reset a setting or set of settings to default values |
| *(needed)* `IconInfo` | Open an informational dialog (e.g., About) |

---

## AI Assistant Panel

| Component | Meaning |
|---|---|
| *(needed)* `IconSend` | Submit a message or prompt to the assistant |
| *(needed)* `IconCancelSend` | Abort an in-progress assistant request |
| *(needed)* `IconClearChat` | Erase the full conversation history in the assistant panel |

---

## Sidebar Navigation

| Component | Meaning |
|---|---|
| *(needed)* `IconCollapseSidebar` | Hide the sidebar panel, giving more space to the main view |
| *(needed)* `IconExpandSidebar` | Reveal the sidebar panel |
| *(needed)* `IconAdd` | Add a new item to a list (clip, region, etc.) |
| *(needed)* `IconSetInPoint` | Mark the current playhead time as the start of a clip or region |
| *(needed)* `IconSetOutPoint` | Mark the current playhead time as the end of a clip or region |
| `IconDetectBPM` | Run automatic BPM detection from the current markers |

---

## Context Menu Actions

These appear in right-click menus and do not currently have icon components, but could use them as leading glyphs.

| Concept | Meaning |
|---|---|
| *(needed)* `IconDeleteAnchor` | Remove a warp anchor point |
| *(needed)* `IconResetAnchorLink` | Clear a manually adjusted beat link, restoring the default beat mapping for that anchor |
| *(needed)* `IconSnapToBeat` | Force an anchor to land exactly on the nearest beat |
| *(needed)* `IconSendToRegion` | Move the selected anchor(s) into a new region |
| *(needed)* `IconCreateMarkerHere` | Place a marker at a specific clicked position on the timeline |
| *(needed)* `IconCreateSceneHere` | Place a scene marker at a specific clicked position on the timeline |
| *(needed)* `IconCreateRegionHere` | Create a region starting at a specific clicked position on the timeline |
