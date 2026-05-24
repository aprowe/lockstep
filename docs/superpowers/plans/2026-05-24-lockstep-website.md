# Lockstep Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dark, single-page Next.js marketing site for Lockstep at `~/lockstep-site`, deployable to Vercel as a static export.

**Architecture:** Single-page (`/`) with five anchor-linked sections (Hero, Features, Guide, Download, Footer). No routing needed. `next export` produces a fully static site. Each section is an isolated React component. Nav uses `useState` for mobile hamburger; Download uses `useState` for platform picker — both are `'use client'` components.

**Tech Stack:** Next.js 14+ (App Router, `output: 'export'`), Tailwind CSS v3, Lucide React, `next/font/google` (Inter + JetBrains Mono)

**Note on testing:** This is a marketing website with no business logic — there are no unit tests to write. Each task ends with a visual verification step using `npm run dev`. Run the dev server once in Task 1 and keep it running.

**Assets source:** `~/Projects/lockstep/docs/` — screenshots and brand files to copy into `public/`.

**Key URLs:**
- GitHub repo: `https://github.com/aprowe/lockstep`
- Releases: `https://github.com/aprowe/lockstep/releases/latest`
- Download URLs use `releases/latest/download/<filename>` — filenames are placeholders; update once CI release artifacts are confirmed.

---

## File Map

```
lockstep-site/
├── next.config.ts              ← static export config
├── tailwind.config.ts          ← custom color/font tokens
├── src/
│   ├── app/
│   │   ├── layout.tsx          ← root layout: fonts, metadata, html/body
│   │   ├── page.tsx            ← composes Nav + all sections
│   │   └── globals.css         ← tailwind directives + scroll-smooth
│   └── components/
│       ├── Nav.tsx             ← sticky navbar, anchor links, mobile hamburger
│       ├── Hero.tsx            ← tagline, CTAs, hero.png
│       ├── Features.tsx        ← 6-card feature grid
│       ├── Guide.tsx           ← 5-step alternating screenshot layout
│       ├── Download.tsx        ← platform picker, license cards, donate row
│       └── Footer.tsx          ← copyright, links
└── public/
    ├── screenshots/            ← copied from lockstep/docs/screenshots/
    └── brand/                  ← copied from lockstep/docs/brand/
```

---

## Task 1: Scaffold the project

**Files:**
- Create: `~/lockstep-site/` (entire project)

- [ ] **Step 1: Run create-next-app**

From your home directory or Projects directory:

```bash
npx create-next-app@latest lockstep-site \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --no-import-alias \
  --yes
```

Expected output ends with: `Success! Created lockstep-site`

- [ ] **Step 2: Install Lucide React**

```bash
cd lockstep-site
npm install lucide-react
```

- [ ] **Step 3: Start dev server**

```bash
npm run dev
```

Open `http://localhost:3000` — you should see the default Next.js welcome page. Keep this terminal running for the rest of the tasks.

- [ ] **Step 4: Commit initial scaffold**

```bash
git init
git add .
git commit -m "chore: scaffold next.js project"
```

---

## Task 2: Configure Next.js, Tailwind, layout, and global CSS

**Files:**
- Modify: `next.config.ts`
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Configure static export in next.config.ts**

Replace the entire file with:

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
}

export default nextConfig
```

- [ ] **Step 2: Set Tailwind custom tokens in tailwind.config.ts**

Replace the entire file with:

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        base: '#0d0d12',
        surface: '#13131e',
        elevated: '#1a1a28',
        border: '#2a2a3a',
        accent: '#7c6af7',
        'accent-soft': '#a78bfa',
        'text-primary': '#e8e8f0',
        'text-muted': '#888899',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 3: Replace globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html {
  scroll-behavior: smooth;
}

body {
  background-color: #0d0d12;
  color: #e8e8f0;
}

/* Subtle scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #0d0d12; }
::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #7c6af7; }
```

- [ ] **Step 4: Replace layout.tsx**

```tsx
import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })

export const metadata: Metadata = {
  title: 'Lockstep — Warp video to any beat',
  description:
    'A desktop app that warps video to a BPM grid so your motion lands on the beat. Free for personal use.',
  openGraph: {
    title: 'Lockstep — Warp video to any beat',
    description:
      'A desktop app that warps video to a BPM grid so your motion lands on the beat. Free for personal use.',
    images: ['/screenshots/hero.png'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans bg-base text-text-primary antialiased">
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 5: Verify in browser**

Check `http://localhost:3000` — the page should have a black background (`#0d0d12`). If you see white, hard-refresh and confirm `globals.css` is imported in `layout.tsx`.

- [ ] **Step 6: Commit**

```bash
git add next.config.ts tailwind.config.ts src/app/globals.css src/app/layout.tsx
git commit -m "chore: configure static export, tailwind tokens, layout fonts"
```

---

## Task 3: Copy screenshot and brand assets

**Files:**
- Create: `public/screenshots/` (7 image files)
- Create: `public/brand/` (2 files)

- [ ] **Step 1: Create public subdirectories and copy assets**

Run from `lockstep-site/`:

```bash
mkdir -p public/screenshots public/brand

# Screenshots
cp ~/Projects/lockstep/docs/screenshots/hero.png          public/screenshots/
cp ~/Projects/lockstep/docs/screenshots/01-overview.png   public/screenshots/
cp ~/Projects/lockstep/docs/screenshots/03-bpm-panel.png  public/screenshots/
cp ~/Projects/lockstep/docs/screenshots/04-markers-on-timeline.png public/screenshots/
cp ~/Projects/lockstep/docs/screenshots/05-align-handle.png public/screenshots/
cp ~/Projects/lockstep/docs/screenshots/07-export-dialog.png public/screenshots/

# Brand
cp ~/Projects/lockstep/docs/brand/lockstep-mark.png public/brand/
cp ~/Projects/lockstep/docs/brand/lockstep-mark.svg public/brand/
```

- [ ] **Step 2: Verify assets are accessible**

Open `http://localhost:3000/screenshots/hero.png` in your browser — you should see the app screenshot. Open `http://localhost:3000/brand/lockstep-mark.svg` — you should see the logo mark.

- [ ] **Step 3: Commit**

```bash
git add public/
git commit -m "chore: add screenshot and brand assets"
```

---

## Task 4: Nav component

**Files:**
- Create: `src/components/Nav.tsx`

- [ ] **Step 1: Create Nav.tsx**

```tsx
'use client'

import { useState } from 'react'
import Image from 'next/image'

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Guide', href: '#guide' },
  { label: 'Download', href: '#download' },
]

export default function Nav() {
  const [open, setOpen] = useState(false)

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-sm border-b border-border">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href="#hero" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <Image src="/brand/lockstep-mark.png" alt="Lockstep logo" width={28} height={28} />
          <span className="font-bold text-text-primary tracking-tight">Lockstep</span>
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-text-muted hover:text-text-primary transition-colors"
            >
              {link.label}
            </a>
          ))}
          <a
            href="https://github.com/aprowe/lockstep"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent hover:text-accent-soft transition-colors"
          >
            GitHub ↗
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-text-muted hover:text-text-primary transition-colors p-1"
          onClick={() => setOpen(!open)}
          aria-label="Toggle navigation menu"
        >
          {open ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-surface border-t border-border px-6 py-4 flex flex-col gap-4">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-text-muted hover:text-text-primary transition-colors"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <a
            href="https://github.com/aprowe/lockstep"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent"
          >
            GitHub ↗
          </a>
        </div>
      )}
    </nav>
  )
}
```

- [ ] **Step 2: Add Nav to page.tsx temporarily to verify**

```tsx
import Nav from '@/components/Nav'

export default function Home() {
  return (
    <>
      <Nav />
      <div className="h-screen" />
    </>
  )
}
```

- [ ] **Step 3: Verify in browser**

At `http://localhost:3000`:
- Nav is fixed at top, dark background (`#13131e`)
- Logo mark and "Lockstep" wordmark visible on left
- Links on right: Features, Guide, Download, GitHub ↗
- Resize to mobile width (< 768px): links disappear, hamburger appears
- Click hamburger: mobile menu opens below nav

- [ ] **Step 4: Commit**

```bash
git add src/components/Nav.tsx src/app/page.tsx
git commit -m "feat: nav component with mobile hamburger"
```

---

## Task 5: Hero section

**Files:**
- Create: `src/components/Hero.tsx`

- [ ] **Step 1: Create Hero.tsx**

```tsx
import Image from 'next/image'

export default function Hero() {
  return (
    <section id="hero" className="pt-32 pb-20 px-6">
      <div className="max-w-5xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight text-text-primary mb-5 leading-tight">
          Cut, sample, and warp<br className="hidden sm:block" /> video to any beat.
        </h1>

        <p className="text-lg md:text-xl text-text-muted mb-10 max-w-2xl mx-auto leading-relaxed">
          Lockstep is a desktop app that warps video to a BPM grid so your motion lands on the beat.{' '}
          <span className="text-accent-soft">Free for personal use.</span>
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
          <a
            href="#download"
            className="w-full sm:w-auto px-7 py-3.5 bg-accent hover:bg-accent-soft text-white font-semibold rounded-lg transition-colors text-sm"
          >
            Download Free ↓
          </a>
          <a
            href="https://github.com/aprowe/lockstep"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto px-7 py-3.5 border border-accent text-accent hover:bg-accent/10 font-semibold rounded-lg transition-colors text-sm"
          >
            View on GitHub ↗
          </a>
        </div>

        <div className="relative rounded-xl overflow-hidden border border-border shadow-[0_0_60px_rgba(0,0,0,0.8)]">
          <Image
            src="/screenshots/hero.png"
            alt="Lockstep — BPM warp timeline showing markers aligned to beat grid"
            width={1280}
            height={800}
            className="w-full"
            priority
          />
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add Hero to page.tsx**

```tsx
import Nav from '@/components/Nav'
import Hero from '@/components/Hero'

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
    </>
  )
}
```

- [ ] **Step 3: Verify in browser**

At `http://localhost:3000`:
- Big dark page with the tagline prominently centered
- "Download Free ↓" filled purple button, "View on GitHub ↗" ghost button
- Hero screenshot below CTAs with dark drop shadow
- On mobile (< 640px): buttons stack vertically

- [ ] **Step 4: Commit**

```bash
git add src/components/Hero.tsx src/app/page.tsx
git commit -m "feat: hero section with tagline, CTAs, and hero screenshot"
```

---

## Task 6: Features section

**Files:**
- Create: `src/components/Features.tsx`

- [ ] **Step 1: Create Features.tsx**

```tsx
import {
  Target,
  Film,
  FolderOutput,
  Scissors,
  Monitor,
  Github,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Feature {
  icon: LucideIcon
  title: string
  description: string
}

const FEATURES: Feature[] = [
  {
    icon: Target,
    title: 'Snap to BPM',
    description:
      'Drop markers on any moment; drag them onto the beat where they should land. The warp engine handles the rest.',
  },
  {
    icon: Film,
    title: 'Time-stretch that looks right',
    description:
      'RIFE frame interpolation keeps stretched motion smooth, not choppy.',
  },
  {
    icon: FolderOutput,
    title: 'Batch export',
    description:
      'Multiple clips, each warped independently. Export them all at once.',
  },
  {
    icon: Scissors,
    title: 'Scene detection',
    description:
      'Automatic cut detection so you know where your natural edit points are.',
  },
  {
    icon: Monitor,
    title: 'Cross-platform',
    description:
      'Native app on Windows, macOS, and Linux. No browser, no cloud.',
  },
  {
    icon: Github,
    title: 'Open source',
    description: 'AGPL-3.0. Fork it, audit it, build on it.',
  },
]

export default function Features() {
  return (
    <section id="features" className="py-24 px-6 bg-surface">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center text-text-primary mb-3">
          Features
        </h2>
        <p className="text-text-muted text-center mb-14">
          Everything you need to lock video to a beat.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div
                key={f.title}
                className="bg-elevated rounded-xl p-6 border border-border hover:border-accent/40 transition-colors"
              >
                <Icon className="w-5 h-5 text-accent mb-3" strokeWidth={1.5} />
                <h3 className="font-bold text-text-primary mb-1.5">{f.title}</h3>
                <p className="text-text-muted text-sm leading-relaxed">{f.description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add Features to page.tsx**

```tsx
import Nav from '@/components/Nav'
import Hero from '@/components/Hero'
import Features from '@/components/Features'

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <Features />
    </>
  )
}
```

- [ ] **Step 3: Verify in browser**

Scroll past the hero — you should see:
- Dark surface background (`#13131e`)
- "Features" heading centered
- 6 cards in 2 columns (desktop) or 1 column (mobile)
- Each card: icon, title, description; border glows purple on hover

- [ ] **Step 4: Commit**

```bash
git add src/components/Features.tsx src/app/page.tsx
git commit -m "feat: features section with 6-card grid"
```

---

## Task 7: Guide section

**Files:**
- Create: `src/components/Guide.tsx`

- [ ] **Step 1: Create Guide.tsx**

```tsx
import Image from 'next/image'

interface Step {
  number: number
  screenshot: string
  alt: string
  heading: string
  caption: string
}

const STEPS: Step[] = [
  {
    number: 1,
    screenshot: '/screenshots/01-overview.png',
    alt: 'Lockstep with a video loaded showing the timeline overview',
    heading: 'Load your video',
    caption:
      'Drag a file in or use File → Open. Lockstep reads the video without re-encoding.',
  },
  {
    number: 2,
    screenshot: '/screenshots/03-bpm-panel.png',
    alt: 'Clip info panel showing BPM input field',
    heading: 'Create a clip and set BPM',
    caption:
      'Define a region and enter your target BPM in the Clip Info panel.',
  },
  {
    number: 3,
    screenshot: '/screenshots/04-markers-on-timeline.png',
    alt: 'Timeline with warp markers placed at key moments',
    heading: 'Drop markers',
    caption:
      'Press M to place a marker at any moment you want to land on a beat.',
  },
  {
    number: 4,
    screenshot: '/screenshots/05-align-handle.png',
    alt: 'Marker beat handle being dragged to align with the beat grid',
    heading: 'Align to the grid',
    caption:
      'Drag each marker's beat handle onto the beat where it should land. The timeline shows the warp in real time.',
  },
  {
    number: 5,
    screenshot: '/screenshots/07-export-dialog.png',
    alt: 'Export dialog showing output file options',
    heading: 'Export',
    caption:
      'Export warped clips as individual files, audio and video time-stretched in sync.',
  },
]

export default function Guide() {
  return (
    <section id="guide" className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center text-text-primary mb-3">
          How it works
        </h2>
        <p className="text-text-muted text-center mb-16">
          Five steps from video to beat-locked clip.
        </p>

        <div className="flex flex-col gap-20">
          {STEPS.map((step) => {
            const isEven = step.number % 2 === 0
            return (
              <div
                key={step.number}
                className={`flex flex-col ${isEven ? 'md:flex-row-reverse' : 'md:flex-row'} items-center gap-8 md:gap-12`}
              >
                {/* Screenshot */}
                <div className="w-full md:w-3/5 rounded-xl overflow-hidden border border-border shadow-[0_0_40px_rgba(0,0,0,0.6)] flex-shrink-0">
                  <Image
                    src={step.screenshot}
                    alt={step.alt}
                    width={900}
                    height={560}
                    className="w-full"
                  />
                </div>

                {/* Text */}
                <div className="w-full md:w-2/5">
                  <div className="text-accent font-mono text-sm font-semibold mb-2 tracking-widest">
                    STEP {step.number}
                  </div>
                  <h3 className="text-2xl font-bold text-text-primary mb-3">
                    {step.heading}
                  </h3>
                  <p className="text-text-muted leading-relaxed">{step.caption}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add Guide to page.tsx**

```tsx
import Nav from '@/components/Nav'
import Hero from '@/components/Hero'
import Features from '@/components/Features'
import Guide from '@/components/Guide'

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <Features />
      <Guide />
    </>
  )
}
```

- [ ] **Step 3: Verify in browser**

Scroll to the Guide section:
- "How it works" heading and subtitle
- 5 steps alternating: odd steps screenshot-left/text-right, even steps reversed
- Step numbers in accent color monospace (`STEP 1`, `STEP 2`, …)
- On mobile: all steps stack screenshot on top, text below

- [ ] **Step 4: Commit**

```bash
git add src/components/Guide.tsx src/app/page.tsx
git commit -m "feat: guide section with 5-step alternating layout"
```

---

## Task 8: Download section

**Files:**
- Create: `src/components/Download.tsx`

- [ ] **Step 1: Create Download.tsx**

> **Note:** The `DOWNLOAD_URLS` constants use Tauri's typical release artifact naming. Update these with actual filenames from the GitHub release assets once CI produces a confirmed build. Check `https://github.com/aprowe/lockstep/releases` for the exact filenames.

```tsx
'use client'

import { useState } from 'react'

type Platform = 'windows' | 'macos' | 'linux'

const PLATFORMS: { id: Platform; label: string; icon: string }[] = [
  { id: 'windows', label: 'Windows', icon: '⊞' },
  { id: 'macos', label: 'macOS', icon: '' },
  { id: 'linux', label: 'Linux', icon: '🐧' },
]

// Update these filenames once confirmed from GitHub release assets:
// https://github.com/aprowe/lockstep/releases/latest
const DOWNLOAD_URLS: Record<Platform, string> = {
  windows: 'https://github.com/aprowe/lockstep/releases/latest/download/Lockstep_x64-setup.exe',
  macos:   'https://github.com/aprowe/lockstep/releases/latest/download/Lockstep_x64.dmg',
  linux:   'https://github.com/aprowe/lockstep/releases/latest/download/lockstep_amd64.AppImage',
}

const PERSONAL_FEATURES = [
  'Full feature set',
  'Windows, macOS, Linux',
  'AGPL-3.0 — source available',
  'Personal & non-commercial use',
]

const COMMERCIAL_FEATURES = [
  'Same binary, full feature set',
  'For-profit workflows & studios',
  'One-time payment, perpetual license',
  'Commercial use without AGPL obligations',
]

export default function Download() {
  const [platform, setPlatform] = useState<Platform>('windows')

  return (
    <section id="download" className="py-24 px-6 bg-surface">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center text-text-primary mb-3">
          Download Lockstep
        </h2>
        <p className="text-text-muted text-center mb-12">
          Free for personal use. $30 one-time for commercial.
        </p>

        {/* Platform picker */}
        <div className="flex justify-center mb-10">
          <div className="flex bg-elevated border border-border rounded-lg p-1 gap-1">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={`px-5 py-2 rounded-md text-sm font-medium transition-colors ${
                  platform === p.id
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <span className="mr-1.5">{p.icon}</span>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* License cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-12">
          {/* Personal — Free */}
          <div className="bg-elevated rounded-xl border border-border p-7 flex flex-col">
            <div className="text-xs font-semibold text-accent tracking-widest uppercase mb-2">Personal</div>
            <div className="text-4xl font-black text-text-primary mb-1">Free</div>
            <div className="text-text-muted text-sm mb-6">For individuals and non-commercial use</div>
            <ul className="space-y-2 mb-8 flex-1">
              {PERSONAL_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-text-muted">
                  <span className="text-accent mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href={DOWNLOAD_URLS[platform]}
              className="block text-center px-6 py-3 bg-accent hover:bg-accent-soft text-white font-semibold rounded-lg transition-colors"
            >
              Download for {PLATFORMS.find((p) => p.id === platform)!.label}
            </a>
          </div>

          {/* Commercial */}
          <div className="bg-elevated rounded-xl border border-accent/40 p-7 flex flex-col">
            <div className="text-xs font-semibold text-accent tracking-widest uppercase mb-2">Commercial</div>
            <div className="text-4xl font-black text-text-primary mb-1">$30</div>
            <div className="text-text-muted text-sm mb-6">One-time payment, perpetual license</div>
            <ul className="space-y-2 mb-8 flex-1">
              {COMMERCIAL_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-text-muted">
                  <span className="text-accent mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="https://your-payment-link-here.com"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center px-6 py-3 border border-accent text-accent hover:bg-accent/10 font-semibold rounded-lg transition-colors"
            >
              Buy License ↗
            </a>
          </div>
        </div>

        {/* Donate row */}
        <div className="text-center border-t border-border pt-10">
          <p className="text-text-muted text-sm mb-4">
            Lockstep is free for personal use. If it saves you time, consider a small donation.
          </p>
          <a
            href="https://github.com/sponsors/aprowe"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 border border-border text-text-muted hover:text-text-primary hover:border-accent/40 rounded-lg transition-colors text-sm"
          >
            ♥ Donate
          </a>
        </div>

        {/* Open source note */}
        <p className="text-center text-text-muted text-xs mt-6">
          Lockstep is open source under{' '}
          <a
            href="https://github.com/aprowe/lockstep/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            AGPL-3.0
          </a>
          .{' '}
          <a
            href="https://github.com/aprowe/lockstep"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            View on GitHub ↗
          </a>
        </p>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add Download to page.tsx**

```tsx
import Nav from '@/components/Nav'
import Hero from '@/components/Hero'
import Features from '@/components/Features'
import Guide from '@/components/Guide'
import Download from '@/components/Download'

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <Features />
      <Guide />
      <Download />
    </>
  )
}
```

- [ ] **Step 3: Verify in browser**

Scroll to the Download section:
- Platform picker shows Windows / macOS / Linux toggle; selected tab fills purple
- Two cards: "Free" (left, standard border) and "$30" (right, purple border)
- Clicking platform buttons updates the "Download for Windows/macOS/Linux" button label
- "Buy License ↗" ghost button on the right card
- Donate row and AGPL note below
- On mobile: cards stack vertically

- [ ] **Step 4: Update payment link**

Replace `https://your-payment-link-here.com` in `DOWNLOAD_URLS` in `Download.tsx` with your actual payment processor URL (Gumroad, LemonSqueezy, etc.) once set up.

- [ ] **Step 5: Commit**

```bash
git add src/components/Download.tsx src/app/page.tsx
git commit -m "feat: download section with platform picker and license cards"
```

---

## Task 9: Footer

**Files:**
- Create: `src/components/Footer.tsx`

- [ ] **Step 1: Create Footer.tsx**

```tsx
export default function Footer() {
  return (
    <footer className="border-t border-border py-8 px-6">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-text-muted">
        <span>© 2026 Lockstep</span>

        <div className="flex items-center gap-6">
          <a
            href="https://github.com/aprowe/lockstep"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://github.com/aprowe/lockstep/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary transition-colors"
          >
            AGPL-3.0 License
          </a>
          <a
            href="mailto:alexrowe707@gmail.com"
            className="hover:text-text-primary transition-colors"
          >
            Commercial inquiries
          </a>
        </div>

        <span className="text-border">Built with Tauri + Rust</span>
      </div>
    </footer>
  )
}
```

- [ ] **Step 2: Add Footer to page.tsx**

```tsx
import Nav from '@/components/Nav'
import Hero from '@/components/Hero'
import Features from '@/components/Features'
import Guide from '@/components/Guide'
import Download from '@/components/Download'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <Features />
      <Guide />
      <Download />
      <Footer />
    </>
  )
}
```

- [ ] **Step 3: Verify in browser**

Scroll to bottom:
- Thin dark footer with top border
- Copyright on left, links in center, tech note on right
- On mobile: stacks vertically, centered

- [ ] **Step 4: Commit**

```bash
git add src/components/Footer.tsx src/app/page.tsx
git commit -m "feat: footer with GitHub, license, and contact links"
```

---

## Task 10: Verify full build and static export

**Files:**
- No new files — this task verifies everything works end-to-end.

- [ ] **Step 1: Run a full visual check of the live page**

Open `http://localhost:3000` and scroll the entire page top to bottom. Check:
- Nav: sticky, logo visible, all links present; click each anchor link to confirm smooth scroll
- Hero: tagline visible, both buttons render, hero screenshot loads
- Features: 6 cards in 2 columns, icons render
- Guide: 5 steps with screenshots, alternating layout on desktop
- Download: platform picker works, both license cards visible, donate row present
- Footer: all links present

- [ ] **Step 2: Check mobile layout**

In browser DevTools (F12), switch to a mobile viewport (375px width). Verify:
- Nav collapses to hamburger; clicking it opens the mobile menu
- Hero buttons stack vertically
- Features show 1 column
- Guide steps stack (screenshot above text)
- Download platform picker fits in width; cards stack

- [ ] **Step 3: Run production build**

Stop the dev server and run:

```bash
npm run build
```

Expected: build completes with no errors. You should see a line like:
```
Route (app)    Size   First Load JS
┌ ○ /          ...
```

The `out/` directory is created (static export).

- [ ] **Step 4: Serve the static export locally**

```bash
npx serve out
```

Open the URL it prints (typically `http://localhost:3000`). Verify the page loads from the static files — same appearance as dev mode.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify static export build"
```

- [ ] **Step 6: Update download filenames**

Open `src/components/Download.tsx` and update `DOWNLOAD_URLS` with the actual artifact filenames from `https://github.com/aprowe/lockstep/releases`. The pattern is:
- Look at the release assets for v0.4.2 (or latest)
- Replace the placeholder filenames in the `DOWNLOAD_URLS` object
- Commit: `fix: update download URLs with actual release asset filenames`

---

## Post-launch checklist

- [ ] Set up payment processor (Gumroad / LemonSqueezy) for the $30 commercial license and update `Buy License ↗` href in `Download.tsx`
- [ ] Set up donate link (GitHub Sponsors / Ko-fi) and update `♥ Donate` href in `Download.tsx`
- [ ] Verify download URLs against actual release assets at `https://github.com/aprowe/lockstep/releases/latest`
- [ ] Add `CNAME` file to `public/` with your domain before deploying (if using a custom domain)
- [ ] Connect repo to Vercel: import project → framework preset `Next.js` → deploy
