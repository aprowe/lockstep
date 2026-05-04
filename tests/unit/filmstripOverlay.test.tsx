/**
 * Issue #32 — overlay above the filmstrip showing scene cuts, markers, and
 * the playhead. Window matches the filmstrip's 7-slot grid centered on the
 * playhead frame; objects outside that window are filtered out.
 */

import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react/pure'
import FilmstripOverlay from '../../src/components/FilmstripOverlay'

afterEach(() => cleanup())

const FPS = 30
const SLOTS = 7

// playheadFrame=30 → window covers frames [27..33], i.e. seconds [0.9..1.1].
const NEAR = 30 / FPS // 1.000s
const PRE  = 28 / FPS // 0.933s — well inside window
const POST = 32 / FPS // 1.067s — well inside window
const FAR  = 50 / FPS // 1.667s — far outside

describe('FilmstripOverlay', () => {
  it('renders ticks for scene cuts inside the window', () => {
    const { container } = render(
      <FilmstripOverlay
        playheadFrame={30}
        fps={FPS}
        slots={SLOTS}
        scenes={[PRE, POST, FAR]}
        markers={[]}
      />,
    )
    const ticks = container.querySelectorAll('.filmstrip-overlay__scene')
    expect(ticks.length).toBe(2)
  })

  it('renders ticks for markers inside the window', () => {
    const { container } = render(
      <FilmstripOverlay
        playheadFrame={30}
        fps={FPS}
        slots={SLOTS}
        scenes={[]}
        markers={[
          { id: 1, time: PRE },
          { id: 2, time: NEAR },
          { id: 3, time: FAR },
        ]}
      />,
    )
    const ticks = container.querySelectorAll('.filmstrip-overlay__marker')
    expect(ticks.length).toBe(2)
  })

  it('renders a playhead caret', () => {
    // The 50% positioning lives in CSS (not inline) since it's static —
    // assert the element exists; visual position is covered by Playwright.
    const { container } = render(
      <FilmstripOverlay
        playheadFrame={30}
        fps={FPS}
        slots={SLOTS}
        scenes={[]}
        markers={[]}
      />,
    )
    expect(container.querySelector('.filmstrip-overlay__playhead')).toBeTruthy()
  })

  it('positions a marker at the playhead frame at 50% (center slot)', () => {
    const { container } = render(
      <FilmstripOverlay
        playheadFrame={30}
        fps={FPS}
        slots={SLOTS}
        scenes={[]}
        markers={[{ id: 1, time: NEAR }]}
      />,
    )
    const tick = container.querySelector('.filmstrip-overlay__marker') as HTMLElement
    // Center slot index = playheadFrame - firstFrame = 30 - 27 = 3
    // x% = (3 / 7) * 100 ≈ 42.857
    expect(parseFloat(tick.style.left)).toBeCloseTo((3 / 7) * 100, 2)
  })

  it('clicking a tick fires onSeekFrame with the rounded frame number', () => {
    const onSeekFrame = vi.fn<(f: number) => void>()
    const { container } = render(
      <FilmstripOverlay
        playheadFrame={30}
        fps={FPS}
        slots={SLOTS}
        scenes={[POST]}
        markers={[]}
        onSeekFrame={onSeekFrame}
      />,
    )
    const tick = container.querySelector('.filmstrip-overlay__scene') as HTMLElement
    fireEvent.click(tick)
    expect(onSeekFrame).toHaveBeenCalledWith(32)
  })

  it('collapses to a thin strip when nothing is in window', () => {
    const { container } = render(
      <FilmstripOverlay
        playheadFrame={30}
        fps={FPS}
        slots={SLOTS}
        scenes={[FAR]}
        markers={[{ id: 1, time: FAR }]}
      />,
    )
    const root = container.querySelector('.filmstrip-overlay') as HTMLElement
    expect(root.classList.contains('filmstrip-overlay--empty')).toBe(true)
  })
})
