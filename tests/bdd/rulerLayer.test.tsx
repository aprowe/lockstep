import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react/pure'
import ThinRuler from '../../src/components/thin/ThinRuler'

const feature = await loadFeature('./spec/features/ruler-layer.feature')

/**
 * happy-dom returns zeros for getBoundingClientRect; the ruler's scrub math
 * needs real pixel dimensions. Stub the body rect post-render so clientX maps
 * deterministically to times.
 */
const RULER_WIDTH = 1200
const VIEW = { start: 0, end: 120 }

function stubRect(el: HTMLElement, left = 0) {
  el.getBoundingClientRect = () => ({
    left, top: 0, right: left + RULER_WIDTH, bottom: 30,
    width: RULER_WIDTH, height: 30, x: left, y: 0, toJSON: () => ({}),
  }) as DOMRect
  ;(el as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {}
  ;(el as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = () => {}
}

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(() => { cleanup() })

  // @behavior ruler-layer::0b84503c
  Scenario('input ruler is scrubbed', ({ Given, When, Then, And }) => {
    const onSeek = vi.fn<(t: number) => void>()
    let body: HTMLElement

    Given('[a video is loaded]', () => {
      const { container } = render(
        <ThinRuler duration={120} view={VIEW} onSeek={onSeek} />
      )
      body = container.querySelector('.thin-row--ruler .thin-row__body') as HTMLElement
      expect(body).not.toBeNull()
      stubRect(body)
    })
    When('the mouse is dragged horizontally along the [input ruler]', () => {
      // clientX=120 → t=12; clientX=600 → t=60; clientX=1080 → t=108
      fireEvent.pointerDown(body, { button: 0, buttons: 1, clientX: 120, clientY: 10, pointerId: 1 })
      // ThinRuler attaches pointermove to the captured element directly.
      body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 600, clientY: 10, pointerId: 1 }))
      body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1080, clientY: 10, pointerId: 1 }))
    })
    Then('the playhead scrubs along with the mouse movement', () => {
      const times = onSeek.mock.calls.map(([t]) => t)
      expect(times.length).toBeGreaterThanOrEqual(3)
      expect(times[0]).toBeCloseTo(12, 1)
      expect(times[1]).toBeCloseTo(60, 1)
      expect(times[times.length - 1]).toBeCloseTo(108, 1)
    })
    And('the video frame updates to match the playhead position', () => {
      // onSeek is the single upstream signal — App.tsx wires it to playerRef.seek,
      // which also dispatches setPlayhead. A call with a valid time completes that chain.
      expect(onSeek).toHaveBeenCalled()
      const calls = onSeek.mock.calls
      const last = calls[calls.length - 1][0]
      expect(last).toBeGreaterThan(0)
      expect(last).toBeLessThanOrEqual(120)
    })
  })
})
