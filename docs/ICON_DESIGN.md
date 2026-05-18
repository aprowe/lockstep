# Lockstep Icon Design Language

A design brief for every icon in the app — what it should look like and why. This is not an SVG spec; it's a vocabulary document. It describes intent and metaphor so that the shapes communicate their meaning even before the user reads a label.

---

## Core themes

Lockstep sits at the intersection of three domains: **time**, **music**, and **video**. Every icon draws from at most two of these. When an icon pulls from all three it gets crowded; the best icons are anchored to one.

| Domain | Visual language |
|---|---|
| Time | Horizontal flow left → right. Vertical lines as moment markers. Arrows as movement through time. |
| Music | Waves, pulses, evenly-spaced ticks. The beat grid. Rhythm implies regularity. |
| Video | Rectangular frames. The filmstrip. Cuts and splices. |

A fourth domain cuts across all three:

| Domain | Visual language |
|---|---|
| Action | The verb layer. Arrows for movement. Plus for creation. X for deletion. Lock for fixity. Arcs for cycling. |

---

## The three object glyphs

Lockstep has three kinds of objects that live on the timeline. Their glyphs are the atomic vocabulary. Every action icon that involves one of these objects incorporates its glyph. If you can read the glyph, you know what the action is about.

### Marker — the pin

A **downward-pointing pin**: a solid filled triangle with the point facing down, planted into the timeline. The metaphor is a thumbtack or map pin. It marks a single instant, a precise moment — not a range, not a category. The triangle should be solid and compact, taller than wide, tip sharp.

All marker icons share this pin shape. The shape does not change; only the surrounding action elements change.

### Region — the span

Two **vertical bracket-walls** (left edge and right edge), each with a short tick at top and bottom like a fence post. Between them, a subtle tinted fill — the interior volume of the region. The metaphor is a segment of the timeline that has been claimed and bounded, like a section of track with buffers at each end.

The interior fill should be very faint (barely-there), so the walls are the primary read. The fill just suggests contained space.

### Scene — the cut

A **diamond** (rotated square, four equal sides). The metaphor is a prismatic dividing point — a categorical edge where something new begins. In film, a scene is a unit of content that starts with a cut; the sharp corners of the diamond echo the abruptness of a cut. The diamond should be solid-filled, centered on the timeline baseline.

The diamond is deliberately angular and pointed, contrasting with the pin's downward-directional shape and the region's horizontal-spanning shape. At a glance, the three glyphs are unmistakable.

---

## Timeline baseline

Every icon whose action involves placing or navigating to something **on the timeline** carries a faint horizontal baseline — a ghost line representing the timeline ruler. Light weight, reduced opacity (about one-third visible), butt caps so it reads as a flat track rather than a stroke.

Icons that operate on an object's **properties** (locking, deleting, renaming) generally do not carry the baseline. They are about the object, not its position.

The baseline sits high (near y=¼ from top) in the marker icons — markers hang like flags from a line above them. It sits low (near y=⅚ from top) in region and scene icons — these objects stand on the timeline floor.

---

## The action vocabulary

Actions are overlaid on object glyphs. The action elements are consistent across all three object types:

### Create — the plus badge

A small **+** cross in the upper-right corner of the icon. Same weight as secondary strokes. Round caps. The + and the × (delete) share the same corner position intentionally — they are each other's inverse.

### Delete — the cross badge

A small **×** cross in the upper-right corner, same size and weight as the + badge. Two diagonal strokes crossing. Shares the position with the + to emphasize the opposition: create vs. destroy.

### Navigate previous — the left chevron

A **<** chevron (V pointing left) placed on the right side of the icon, with the object glyph on the left. The object is behind the current position; the chevron points back toward it.

### Navigate next — the right chevron

A **>** chevron (V pointing right) placed on the left side of the icon, with the object glyph on the right. The object is ahead; the chevron points forward toward it.

### Set boundary — the descending arrow

A vertical line with a **downward arrowhead** — the playhead being lowered into position at a boundary. Used when you are defining where a region's edge lives by dropping the playhead down to it.

### Go to boundary — the stop-and-arrow

The object's boundary glyph (a bracket wall, no interior) acts as the destination. A chevron points toward it. The bracket wall is the destination; the chevron is the approach. No descending arrow — navigation, not setting.

### Snap — the grid tick alignment

The object glyph sitting precisely on one of several evenly-spaced short tick marks (the beat grid). The precision of the alignment — the glyph flush against the tick rather than floating between them — is the message.

### Reset — the return arc

A partial circular arc (~270°) with an arrowhead at its open end, placed near the object. The near-complete circle suggests cycling back to a prior state. Secondary stroke weight.

---

## Implemented icons — what they should mean visually

### Playback

**Play** — A single forward-pointing solid triangle. Large, centered, no baseline. Transport controls don't need the timeline vocabulary — they operate independently of objects on the timeline.

**Pause** — Two solid vertical rounded bars, equal width, side by side. The gap between them is the pause. No baseline.

**Step back one frame** — A vertical bar on the right edge (the "just-passed frame boundary"), a leftward-pointing triangle or chevron stepping back from it, and a faint horizontal midline as the motion track. The bar is the wall; the triangle bounces off it.

**Step forward one frame** — Mirror of step back: bar on the left, rightward triangle stepping away from it, faint horizontal midline.

### Loop modes

Three modes for what happens when playback reaches a boundary. They should feel like a family — three states of the same question.

**Stop** — A bold square with a faint fill. The universal stop signal. Centered, unambiguous. The boundary is a wall.

**Loop** — Two curved arrows forming a complete cycle — one arc from right to left across the top, one arc from left to right across the bottom, each with an arrowhead. Together they trace a closed loop. The boundary is a door that loops back to the entrance.

**Continue** — A horizontal arrow pointing right, past a faint vertical line in the center. The arrow pierces the boundary and keeps going. Clean and linear. The boundary is permeable.

### Markers

**Create marker** — Pin glyph on the timeline baseline. Plus badge in the upper right.

**Previous marker** — Timeline baseline. Pin glyph on the left side of the icon. Left chevron on the right side of the icon.

**Next marker** — Timeline baseline. Pin glyph on the right side. Right chevron on the left side.

### Regions

**Create region** — Region bracket glyph (both walls + faint interior). Plus badge centered inside the interior — not in a corner, because the region has interior space, and the + lives inside what it creates.

**Set in-point** — Timeline baseline. Left bracket wall (left edge only, with ticks) standing on the baseline. A descending arrow approaching the bracket from the right — the playhead being placed at the left edge.

**Set out-point** — Mirror of set in-point: right bracket wall, descending arrow approaching from the left.

**Go to in-point** — Left bracket wall as the destination. Left chevron pointing toward it from the right. No baseline (navigation is not placement).

**Go to out-point** — Right bracket wall as the destination. Right chevron pointing toward it from the left.

**Previous region** — Timeline baseline. Small full region glyph (both walls, faint interior) on the left side. Left chevron on the right side.

**Next region** — Timeline baseline. Small full region glyph on the right side. Right chevron on the left side.

**Zoom to region** — Two full-height vertical lines as the outer boundary. Between them, inward-pointing chevrons on both sides — the view compressing to fill the region. The "zooming in" motion is the collapsing of space between walls.

**Deselect** — A circle (neutral, non-object-specific boundary) with an X through it. The circle says "a selection exists"; the X says "release it." The circle matters — without it, this reads as close/delete rather than "clear selection."

### Scenes

**Create scene** — Scene diamond on the timeline baseline. Plus badge in the upper right.

**Previous scene** — Timeline baseline. Scene diamond on the left side. Left chevron on the right side.

**Next scene** — Timeline baseline. Scene diamond on the right side. Right chevron on the left side.

### BPM / beat locking

**Lock closed** — A padlock: a rounded rectangular body (faint fill) with a closed U-shaped shackle arching above it, and a small keyhole dot centered on the body. The shackle is symmetrically closed — both ends descend into the body. Closed = fixed.

**Lock open** — Same padlock body and keyhole. The shackle is open: one leg descends into the body; the other hangs free, the arc broken. The broken connection is the visual metaphor for "free to change."

### Timeline toolbar toggles

Each toggle controls whether a layer on the timeline is always visible or fades at low zoom. They share a micro-language: a **dashed vertical line** (the timeline marker in its "might be hidden" state) + the object's glyph. The dashes represent latency or conditional visibility — the marker exists but may not be rendered.

**Toggle warp overlay** — Two sine waves running horizontally across the icon (one for original timing, one for beat timing). The waves are the warp map made visible. No dashed line — this toggles a visualization, not a marker type.

**Always show anchors** — Dashed full-height vertical line at center. Pin glyph (small version) at the top of the line. The pin sits on the line even though the line is dashed — it's there even when you can't see it.

**Always show regions** — Two dashed full-height vertical lines (left edge, right edge). A small region band spanning between them at mid-height. The dashed walls with a solid interior communicates "the span is defined even when boundaries are faint."

**Always show scenes** — Dashed full-height vertical line at center. Small diamond at mid-height on the line. Same logic as always-show anchors.

**Toggle thumbnail strip** — A grid of cells: a rounded rectangle divided by two horizontal lines and two vertical lines, forming a 3×3 contact sheet. The grid directly represents the thumbnail filmstrip.

**Follow drag mode** — A filled circle (the playhead) with four short lines radiating out from it — up, down, left, right. The crosshair suggests the view centers on the playhead; the filled center dot emphasizes the playhead as the focal point that pulls the view.

**Queue debug** — A small panel / document shape with three horizontal lines of decreasing length inside (a list). A small filled circle in the lower-right corner — a status badge or active-process indicator.

---

## Needed icons — what they should be

### Playback

**Stop** — A solid filled square (not tinted — fully filled, definitive), with a vertical bar to its left. Together they read as "return to start and stop," the standard transport end symbol. Distinguish from the loop-stop square (which is tinted and centered alone) by being fully filled and paired with the bar.

---

### Markers

**Delete marker** — Timeline baseline. Pin glyph on the baseline. Delete × badge in the upper right — the same corner as the create + badge. The ×/+ duality at the same position makes them unmistakable as opposites.

**Snap marker to beat** — Timeline baseline. Three or four evenly-spaced short vertical tick marks along the baseline (the beat grid). A pin glyph sitting exactly on one tick — the tip of the pin touching the tick precisely. The alignment is the message: one pin, one beat, perfect.

**Reset marker beat link** — Timeline baseline. Pin glyph on the baseline. A small partial circular arc with an arrowhead (the reset symbol) overlaid near the top of the pin — the beat assignment unwinding back to default.

**Import markers** — Timeline baseline. Two or three pin glyphs already on the baseline. An arrow entering from the left edge of the icon, pointing rightward into the group of pins. Data arriving from outside and becoming markers. The multiple pins contrast with single-pin create; the inbound arrow contrasts with the + badge (internal creation vs. external loading).

---

### Regions

**Rename region** — Region bracket glyph (both walls, faint interior). A small pencil shape inside the interior — a diagonal stroke with a pointed tip at one end, representing writing. The pencil inside the bounded space means "edit the label of what is inside."

**Duplicate region** — Two region bracket glyphs, the second slightly behind and offset to the right of the first. The same overlapping-copy convention used in every platform's "duplicate" icon. The original is in front; the copy is behind.

---

### Scenes

**Delete scene** — Timeline baseline. Diamond glyph on the baseline. Delete × badge in the upper right. Mirrors delete marker exactly, with the diamond in place of the pin.

**Seek to scene** — Timeline baseline. Diamond glyph on the baseline. A rightward arrow approaching the diamond from the left, its tip meeting the diamond's left edge. The arrow is the playhead traveling to the scene's position.

---

### File & folder operations

**Open folder** — A folder shape (a simple rectangle with a small raised tab at the top-left corner, the classic folder outline). An upward arrow inside, suggesting the folder opening and content rising out of it. The raised tab is what makes it readable as a folder vs. a document.

**Open file / load video** — A document shape (rectangle with a folded corner at top-right, the classic page curl). A small play triangle overlaid inside — this is not a generic document but a video file. An upward-then-leftward arrow entering the document from the bottom suggests loading.

**Reveal in file manager** — A folder shape. A small diagonal arrow exiting the top-right corner of the folder, pointing away from it — the file being surfaced in the OS. The outward direction distinguishes this from Open Folder's inward loading gesture.

**Export** — A rightward arrow exiting through the right side of a simple box. The box represents the edit session; the arrow crosses its right wall and escapes. The crossing of a boundary is the key visual — output leaving the system.

**Save output** — A downward arrow descending to rest on a horizontal tray or thick baseline. The arrow represents the output file landing on disk. The tray is the storage destination. This is different from Export: export is crossing a boundary outward; save is descending to a resting place.

**Browse for folder** — A folder shape with a small magnifying glass overlaid at the lower-right corner. The magnifying glass means "look inside." The folder says where you're looking.

---

### Edit actions

**Rename** — A diagonal pencil: a long stroke at roughly 45° with a pointed tip at the lower-left (the writing point) and a flat cap at the upper-right (the eraser end). A short horizontal line directly below the tip — the writing baseline. No other elements. The pencil is universal and needs no decoration.

**Clear all** — Three horizontal lines of equal length stacked vertically (a simple list). A wide sweep stroke crossing diagonally through all three from upper-left to lower-right. The sweep erases the list.

**Undo** — A leftward-sweeping arc (counter-clockwise, about ¾ of a circle) with an arrowhead at the clockwise end — the motion reverses. The arc opens downward. Standard and universal; don't reinvent this one.

**Redo** — Mirror of undo: rightward-sweeping clockwise arc with an arrowhead at the counter-clockwise end. The arc opens downward.

---

### Settings & app chrome

**Close** — Two diagonal lines crossing at center. No surrounding circle or boundary — the × stands alone, confident. Round caps. This is the most unadorned form; anything that closes a panel or dialog uses exactly this.

**Minimize window** — A single short horizontal bar at the lower-center of the icon. Nothing else. The reduction is the message — the window collapses to this line.

**Maximize window** — A square outline (stroked, no fill) that nearly fills the viewBox, with diagonal outward arrows at two opposite corners (upper-left and lower-right). The arrows push the square toward the edges of the screen.

**Restore window** — Two overlapping squares, the front one fully stroked and the back one visible only at its upper-right corner. Communicates "switching between two sizes." The back square is a ghost of the maximized state.

**Show/hide sensitive value** — An eye: an outer almond shape (the eyelid curve, arcing above and below) with a filled circle (the pupil) centered. The pupil should be large enough to read clearly as an eye, not confused with a lens. This is the "show" state.

For the "hide" (eye-off) state: the same eye shape but with a diagonal slash (same weight as Close ×) crossing through it from upper-right to lower-left. The slash shares the deletion/negation visual vocabulary established by Close and Delete.

**Reset to defaults** — A circular arc (about 270°, missing the lower-left quarter) with an arrowhead at the open end pointing counter-clockwise. Lighter stroke weight — this is a secondary action, not primary.

**About / info** — A circle (stroked, no fill). Inside: a small filled circle for the dot of the "i", and a short vertical stroke below it — the stem. The lowercase "i" inside a circle is the universal information symbol and needs no elaboration.

---

### AI assistant panel

**Send message** — A rightward-pointing arrow, slightly heavier than the navigation chevron. This icon shares its visual DNA with the Continue loop icon (same rightward-arrow form), intentionally — both represent "push forward into what comes next." The send arrow can have a faint horizontal tail to distinguish it from a bare chevron.

**Cancel in-progress request** — A filled circle with a bold × centered inside it. The circle is more prominent here than in Deselect — this is a strong interrupt signal, not a gentle clear. The circle makes it feel like a button being activated.

**Clear conversation** — A speech bubble outline (a rounded rectangle with a small triangular tail at the lower-left). Inside the bubble: two or three faint short horizontal lines (the text content). A sweep stroke or × crossing the lines. The bubble form anchors it to "conversation"; the crossing clears it.

---

### Sidebar navigation

**Collapse sidebar** — A vertical panel shape (tall, narrow rectangle) on the left side of the icon. An arrow pointing leftward, exiting the panel's left edge. The panel is folding out of view. The arrow exits the domain of the panel entirely — it doesn't just point left inside the icon, it crosses the panel's own boundary.

**Expand sidebar** — Same vertical panel shape. Arrow pointing rightward, entering the panel from outside. Content arriving into the panel domain.

**Add item** — A plain + cross, slightly heavier than the create badge. No surrounding shape. This is the direct "add to a list" action, not the nuanced "create on the timeline" action; it should feel simpler and more generic.

**Set in-point (clip level)** — A single left bracket wall (vertical line + short rightward ticks at top and bottom — just one wall, not a full region). A downward arrow adjacent to it, descending to the same baseline as the bracket foot. Same metaphor as Set Region Start but for clip-level boundaries.

**Set out-point (clip level)** — Mirror of set in-point: right bracket wall with a descending arrow.

**Detect BPM automatically** — A beat grid (three or four evenly-spaced tick marks along a horizontal baseline) with a small lightning bolt or spark shape above the center tick. The tick grid is the music's rhythmic structure; the bolt is the act of automatic detection — computation striking the grid and revealing its tempo. The bolt should be small — a secondary element on the grid, not the primary shape.

---

### Context menu actions

These appear at small sizes as leading glyphs inside menu rows. Silhouette must do all the work.

**Delete anchor** — A small filled circle (the anchor point) with a tiny × immediately beside it. Two elements, no baseline. The circle is the same visual atom as the keyhole dot in the lock icons and the center of the Follow Drag icon — it reads as "a control point."

**Reset anchor beat link** — Two small filled circles connected by a short horizontal line. A small reset arc (a partial arc with an arrowhead) crossing the connecting line. The arc breaks and re-establishes the link — the connection being reset to its default beat assignment.

**Snap anchor to beat** — A filled circle (anchor point) with a vertical tick below it (a beat gridline), and a small downward arrow between them — the anchor snapping down onto the gridline. The downward direction is consistent with all "set to this position" arrows in the icon system.

**Send anchor to new region** — A filled circle (anchor point). An arrow pointing rightward from it into a left bracket wall (the opening edge of a region). The anchor moves into the region's domain.

**Create marker here** — A simplified marker pin (small, without the baseline context) with a vertical line above it representing the "here" position — the playhead dropping the pin.

**Create scene here** — A small diamond with a short vertical line above it (the "here" marker). Matches create-marker-here structurally: the object glyph + a "here" indicator above it.

**Create region here** — A left bracket wall only (the opening edge of a region) with a short vertical tick above the top tick mark — "the region starts here." The partial bracket (left wall only) communicates initiation, not completion.
