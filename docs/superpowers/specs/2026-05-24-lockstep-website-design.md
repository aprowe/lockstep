# Lockstep Website Design

**Date:** 2026-05-24
**Status:** Approved — ready for implementation planning
**Output:** `~/lockstep-site` — Next.js project, Vercel-deployable

---

## Overview

A single-page marketing website for Lockstep, a native desktop app for BPM-warping video to music. The site is modeled after losslesscut.net: one long scrolling page with anchor-linked nav items that read like page links and can be broken out into real routes later. Built in Next.js, exported as static, deployable to Vercel with zero config.

---

## Constraints & Context

- **Product status:** Pre-release (v0.4.1), active development
- **License model:** AGPL-3.0 (free for personal/non-commercial) + $30 one-time commercial license
- **Platforms:** Windows, macOS, Linux
- **Visual style:** Full dark — matches the app's own dark-mode-only UI
- **Assets available:** `docs/hero.png` (hero screenshot), 8 workflow screenshots in `docs/`
- **Payment processor:** TBD — purchase CTA links to a placeholder URL (e.g. Gumroad/LemonSqueezy) to be wired up post-launch
- **Contact:** alexrowe707@gmail.com (commercial inquiries)

---

## Tech Stack

- **Framework:** Next.js 14+ (App Router, `output: 'export'` for static)
- **Styling:** Tailwind CSS v3
- **Fonts:** Inter (body) + a monospace for code/tagline accents
- **Icons:** Lucide React
- **Deployment:** Vercel (or any static host via `next export`)

---

## Site Structure

Single page at `/`, all sections reachable via anchor links. No client-side routing needed.

### Nav

Sticky dark navbar, full width. Left: Lockstep logo mark + wordmark. Right: anchor links + GitHub.

```
[Lockstep logo]    Features   Guide   Download   [GitHub ↗]
```

Nav links use `href="#features"` etc. On mobile, collapses to hamburger.

---

## Sections

### 1. Hero `#hero`

- **Background:** Deep dark (`#0d0d12` or similar), subtle noise texture or gradient
- **Tagline (h1):** *"Cut, sample, and warp video to any beat."*
- **Subhead:** One sentence — *"Lockstep is a desktop app that warps video to a BPM grid so your motion lands on the beat. Free for personal use."*
- **CTAs (row):**
  - Primary: `Download Free ↓` — smooth-scrolls to `#download`
  - Secondary (ghost button): `View on GitHub ↗` — opens GitHub repo in new tab
- **Hero image:** `docs/hero.png` full-width below the CTA row, dark drop shadow, slight rounded corners
- **Mobile:** Stack CTAs vertically; hero image stacked below

### 2. Features `#features`

- **Layout:** 2-column grid on desktop, 1-column on mobile
- **Count:** 6 feature cards
- **Each card:** Icon (Lucide) + bold heading + 1–2 sentence description
- **Features:**
  1. **Snap to BPM** — Drop markers on any moment; drag them onto the beat where they should land. The warp engine handles the rest.
  2. **Time-stretch that looks right** — RIFE frame interpolation keeps stretched motion smooth, not choppy.
  3. **Batch export** — Multiple clips, each warped independently. Export them all at once.
  4. **Scene detection** — Automatic cut detection so you know where your natural edit points are.
  5. **Cross-platform** — Native app on Windows, macOS, and Linux. No browser, no cloud.
  6. **Open source** — AGPL-3.0. Fork it, audit it, build on it.

### 3. Guide `#guide`

- **Intro:** *"How it works — five steps from video to beat-locked clip."*
- **Layout:** Alternating left/right on desktop (odd steps: screenshot left, text right; even: reversed). Single column on mobile.
- **Steps (5):** Each has a screenshot + step number + heading + 1-sentence caption
  1. **Load your video** — Drag a file in or use File → Open. Lockstep reads the video without re-encoding.
  2. **Create a clip and set BPM** — Define a region and enter your target BPM in the Clip Info panel.
  3. **Drop markers** — Press M to place a marker at any moment you want to land on a beat.
  4. **Align to the grid** — Drag each marker's beat handle onto the beat where it should land. The timeline shows the warp in real time.
  5. **Export** — Export warped clips as individual files, audio and video time-stretched in sync.
- **Screenshots:** Use `docs/` workflow screenshots in order: overview, BPM panel, markers, alignment, export

### 4. Download `#download`

- **Heading:** *"Download Lockstep"*
- **Platform row:** Three buttons side by side — `Windows`, `macOS`, `Linux`. Each links to the appropriate release binary (GitHub Releases). Placeholder `#` until release is published.
- **License cards (2-column):**

  **Personal — Free**
  - For individual, non-commercial use
  - AGPL-3.0 license
  - Full feature set
  - CTA: `Download` — clicking downloads for the OS selected in the platform row above

  **Commercial — $30**
  - For commercial use, studios, for-profit workflows
  - One-time payment, perpetual license
  - Same full feature set, same binary
  - CTA: `Buy License ↗` — links to payment processor (TBD, placeholder URL for now)

- **Donate row:** Below the cards — *"Lockstep is free for personal use. If it saves you time, consider a small donation."* + Donate button (links to Ko-fi / GitHub Sponsors / TBD)
- **Footer note:** *"Lockstep is open source under AGPL-3.0. [View on GitHub ↗]"*

### 5. Footer

- Single dark row
- Left: © 2026 Lockstep
- Center: `GitHub` | `License` (links to AGPL-3.0 text) | `Commercial inquiries → alexrowe707@gmail.com`
- Right: *"Built with Tauri + Rust"* (optional nerd cred)

---

## Visual Design

### Color palette

| Token | Value | Usage |
|-------|-------|-------|
| `bg-base` | `#0d0d12` | Page background |
| `bg-surface` | `#13131e` | Cards, nav |
| `bg-elevated` | `#1a1a28` | Feature cards, code blocks |
| `border` | `#2a2a3a` | Card borders, dividers |
| `accent` | `#7c6af7` | Buttons, highlights, links |
| `accent-soft` | `#a78bfa` | Secondary accents |
| `text-primary` | `#e8e8f0` | Headings |
| `text-muted` | `#888899` | Body, captions |

### Typography

- **Headings:** Inter 700–900, tight tracking
- **Body:** Inter 400, 16px, 1.6 line-height
- **Accent/mono:** JetBrains Mono or `font-mono` for tagline or code snippets

### Buttons

- **Primary:** Solid accent (`#7c6af7`), white text, rounded-lg, hover: lighten
- **Ghost:** Transparent, accent border, accent text, hover: fill with 10% accent

---

## Responsive Behavior

- **Desktop:** ≥1024px — two-column features grid, side-by-side guide steps
- **Tablet:** 768–1023px — single-column features, stacked guide
- **Mobile:** <768px — hamburger nav, all sections single-column, platform buttons stacked

---

## Out of Scope

- Blog / changelog
- Authentication
- Actual payment processing (purchase CTA is a link to external processor)
- Docs site (guide section is just the workflow overview, not full docs)
- Dark/light mode toggle (dark only, matching the app)

---

## Open Questions

- **Payment processor:** Which service handles the $30 commercial license? (Gumroad, LemonSqueezy, Stripe, GitHub Sponsors?) — TBD, placeholder link for now.
- **Donate platform:** Ko-fi, GitHub Sponsors, or other? — TBD, placeholder for now.
- **Download links:** Point to `https://github.com/aprowe/lockstep/releases/latest` — releases exist. Per-platform asset links follow the pattern `https://github.com/aprowe/lockstep/releases/latest/download/<filename>` — actual filenames TBD from the release assets.
- **Domain:** Where will the site be hosted? (lockstep.app, lockstepapp.com, etc.)
