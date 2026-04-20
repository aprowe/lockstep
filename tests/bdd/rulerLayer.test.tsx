import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react/pure'
import Timeline from '../../src/components/Timeline'

const feature = await loadFeature('./spec/features/ruler-layer.feature')

/**
 * happy-dom returns zeros for getBoundingClientRect; the Timeline's `xToTime`
 * needs real pixel dimensions to map clientX → time. We stub the ruler's rect
 * post-render so drag positions translate to deterministic times.
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
    const onRulerClick = vi.fn<(t: number) => void>()
    let ruler: HTMLElement

    Given('[a video is loaded]', () => {
      const { container } = render(
        <Timeline
          duration={120}
          anchors={[]}
          view={VIEW}
          onViewChange={() => {}}
          onRulerClick={onRulerClick}
        />
      )
      ruler = container.querySelector('.ruler') as HTMLElement
      expect(ruler).not.toBeNull()
      stubRect(ruler)
    })
    When('the mouse is dragged horizontally along the [input ruler]', () => {
      // clientX=120 → t=12; clientX=600 → t=60; clientX=1080 → t=108
      fireEvent.pointerDown(ruler, { button: 0, buttons: 1, clientX: 120, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(ruler, { buttons: 1, clientX: 600, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(ruler, { buttons: 1, clientX: 1080, clientY: 10, pointerId: 1 })
    })
    Then('the playhead scrubs along with the mouse movement', () => {
      const times = onRulerClick.mock.calls.map(([t]) => t)
      expect(times.length).toBeGreaterThanOrEqual(3)
      expect(times[0]).toBeCloseTo(12, 1)
      expect(times[1]).toBeCloseTo(60, 1)
      expect(times[times.length - 1]).toBeCloseTo(108, 1)
    })
    And('the video frame updates to match the playhead position', () => {
      // onRulerClick is the single upstream signal — App.tsx wires it to playerRef.seek,
      // which also dispatches setPlayhead. A call with a valid time completes that chain.
      expect(onRulerClick).toHaveBeenCalled()
      const calls = onRulerClick.mock.calls
      const last = calls[calls.length - 1][0]
      expect(last).toBeGreaterThan(0)
      expect(last).toBeLessThanOrEqual(120)
    })
  })
})
