🎛️ Lockstep Design System Spec (Neon Rhythm Theme)
🧠 Core identity

Lockstep is a motion-to-rhythm transformation tool:

organic movement → quantized BPM grid
human motion → structured visual timing
chaos → alignment

Visual language:

“precise system with energetic motion inside it”

🌑 1. Color System
Base background (dark system layer)

Use deep near-black with subtle variation (not pure black):

BG-0 (base): #0B0F14
BG-1 (surface): #0E141B
BG-2 (raised panels): #121A24
BG-3 (active surface highlight): #182433
Neon primary (motion / rhythm)

Main identity color:

Neon Cyan: #00E5FF
Alternative slightly greener cyan: #00FFC6

Usage:

active states
sync lines
BPM grid highlights
selected elements
Secondary neon accents

Used sparingly for energy variation:

Electric Violet: #8A5CFF
Magenta Pulse: #FF3DCE
Amber Beat (rare): #FFB020
Neutral UI text
Primary text: #EAF2FF
Secondary text: #9AA7B5
Disabled text: #5A6A7A
Grid overlay color
subtle cyan at ~8–12% opacity
#00E5FF at low alpha (0.08–0.12)

📐 2. Layout System
Grid system
Base grid: 8pt system
UI elements align strictly to 8px increments
Spacing scale
4px (micro spacing)
8px (base unit)
16px (small gap)
24px (medium gap)
32px (large gap)
48px (section spacing)
64px+ (layout separation)
Layout feel
slightly dense (pro tool, not consumer app)
strong alignment everywhere
no “floating randomness”
🧱 3. Shape Language
Border radius system

This is important for “precision vs softness” balance:

Small UI elements: 6px
Buttons / inputs: 10px
Cards / panels: 14px
Large containers: 18px
Hero surfaces (rare): 24px

👉 Rule:

nothing fully circular except motion dots or indicators

Lines & strokes
default stroke: 1.5px
emphasized stroke: 2px
grid lines: 1px (low opacity neon)
Corners
Slightly softened but still “technical”
Avoid fully rounded iOS-style UI (kills precision feel)
💡 4. Glow & Neon Effects
Neon glow rules (very important)

Use sparingly:

Inner glow: cyan at 15–25% opacity
Outer glow: blur radius 8–16px max
No heavy bloom or over-glow
Active state glow behavior

When elements “lock into rhythm”:

snap animation (no easing softness)
brief 150–250ms neon pulse
then stabilize (no constant glow)
🎞️ 5. Motion System (core of the brand)
Motion principles
snappy, quantized movement
avoid smooth lazy easing
transitions feel “locked to beats”
Easing curves

Use custom “hard sync” easing:

accelerate fast → snap → settle quickly
avoid long inertia easing

Suggested curve style:

cubic-bezier(0.2, 0.9, 0.1, 1)
Key animation pattern

“misaligned → jitter → snap into grid”

Used for:

clip alignment
timeline syncing
step detection
🧩 6. Components
Buttons
Primary button
BG: #00E5FF at 15–20% opacity
Border: 1.5px neon cyan
Radius: 10px
Hover: +10% brightness + subtle glow
Active state
full neon fill
quick pulse animation (1 cycle only)
Cards
BG: #121A24
Border: 1px solid rgba(0, 229, 255, 0.08)
Radius: 14px
Optional subtle grid texture overlay
Timeline / waveform area
background slightly darker than surface
vertical grid lines at BPM intervals
active beat line = neon cyan
Sliders
track: dark gray-blue
fill: neon cyan
thumb: glowing cyan dot (6–10px radius)
📊 7. Grid / BPM Visual Language

This is your signature system:

Grid rules
vertical lines = time divisions
horizontal = motion layers
BPM markers glow stronger every beat
Alignment effect

When motion locks:

elements “snap” to nearest grid line
micro-shift animation (2–4px correction)
brief neon flash
🧿 8. Icon system style (important for consistency)
geometric
minimal
centered composition
often based on:
dots
lines
grid intersections
alignment states

No:

illustrations
realism
cluttered detail
🧠 9. Brand personality summary

Lockstep feels like:

precision instrument
rhythm engine
motion quantizer
visual metronome system

Not:

social app
casual editor
music player
