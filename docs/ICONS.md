📘 Lockstep UI Icon System Spec

Product: Lockstep
Domain: BPM-based video motion quantization tool
System: Timeline + marker + region + frame navigation controls
Style: Neon precision / grid-based motion system

1. 🧠 Core Design Principles

All icons must follow these principles:

1.1 Visual language
Motion → structure
Time → grid
Clips → quantized alignment points
Regions → bounded brackets of time
Frames → discrete steps
1.2 Style rules
Monoline geometric icons (primary style)
24px grid system
Stroke-based, not filled (except small dots where necessary)
Pixel-snapped alignment
1.3 Stroke system
Default stroke: 2px
Secondary details: 1.5px
Dot elements: 2–3px solid circles
2. 📐 Layout System
Canvas
Base icon size: 24x24px
Safe padding: 2px minimum
Optical alignment required (not mathematically centered if visually off)
Grid
24px grid
Snap all endpoints to grid intersections where possible
3. 🎨 Color System
Default state
Icon stroke: #9AA7B5 (muted blue-gray)
Active state
Primary neon: #00E5FF (cyan)
Optional secondary accent: #8A5CFF (violet)
Background assumption (not part of icon)
Deep dark UI: #0B0F14 or similar
4. ⚡ Motion Rules (UI behavior, not drawing)
Activation animation
Instant snap transition (no long easing)
150–250ms neon glow pulse on activation
No continuous glow loops
Easing guideline
Fast acceleration → hard snap → stable settle
Avoid smooth inertial easing
5. 🎬 ICON SET SPECIFICATIONS
5.1 Play
Meaning:

Start playback / activate motion

Design:
Right-facing triangle (▶)
Slight geometric cut edges (not rounded blob triangle)
Optional: thin vertical “beat line” behind triangle (subtle timeline hint)
5.2 Next Frame
Meaning:

Advance one discrete frame

Design options (choose one consistent approach):
| → (vertical bar + right arrow)
OR right arrow with trailing frame tick mark
Must visually imply “step forward one unit”
5.3 Previous Frame
Meaning:

Go back one frame

Design:
Mirror of Next Frame: ← |
Keep symmetry with Next Frame icon system
6. 📍 MARKER SYSTEM ICONS
6.1 Create Marker
Meaning:

Insert a BPM/timeline anchor point

Design:
Single centered dot on timeline baseline
Optional: small plus sign OR faint radial pulse ring

Core metaphor:

“anchor point in time grid”

6.2 Next Marker
Meaning:

Jump to next marker in timeline

Design:
Right arrow + small dot ahead on implied timeline
OR dot + chevron indicating forward jump
6.3 Previous Marker
Meaning:

Jump to previous marker

Design:
Mirror of Next Marker (left direction)
7. 🧱 REGION SYSTEM ICONS
7.1 Create Region
Meaning:

Define a time-bounded segment

Design:
Two vertical bracket shapes: [ ]
Subtle dashed fill between brackets
Fill is low opacity neon cyan

Core concept:

“bounded rhythmic segment”

7.2 Set Beginning (Region Start)
Meaning:

Define region start point

Design:
Left bracket [
Downward small arrow pointing into timeline line
7.3 Set End (Region End)
Meaning:

Define region end point

Design:
Right bracket ]
Upward arrow exiting timeline line
7.4 Beginning of Region (Jump to Start)
Meaning:

Navigate to region start

Design:
Left bracket emphasis + directional arrow toward start point
7.5 End of Region (Jump to End)
Meaning:

Navigate to region end

Design:
Right bracket emphasis + directional arrow toward end point
8. ⏱ FRAME NAVIGATION ICONS
8.1 Next Frame
Meaning:

Advance by single frame increment

Design:
Vertical tick line + right arrow
Must imply discrete step movement, not smooth motion
8.2 Previous Frame
Meaning:

Go back one frame

Design:
Mirror of Next Frame
9. 🧩 SHARED VISUAL MOTIFS

All icons should reuse these metaphors:

9.1 Timeline baseline
Invisible or faint horizontal reference line
All marker icons assume alignment to this line
9.2 Dots = events
Represent motion points, beats, markers
9.3 Brackets = regions
Always represent time boundaries
9.4 Arrows = time direction
Always indicate temporal movement (not UI navigation)
10. 🧿 BRAND FEEL

The system should feel:

precise
rhythmic
technical but creative
like a “motion quantization engine”

Avoid:

playful emoji-like icons
overly rounded iOS-style UI
music note clichés
complex illustrative symbols
11. 🚨 CONSISTENCY REQUIREMENTS
All icons must feel like one system
Same stroke thickness across set
Same corner logic across shapes
Same neon accent logic
No mixing filled vs outline styles inconsistently
