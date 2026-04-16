import { it, expect } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { calcZoomToRegion, viewFitsRegion } from '../../src/utils/view'
import { behaviorTest } from '../helpers/runBehavior'
import { renderTimeline } from '../harnesses/timeline'

// region-editing::35ddd908
// Scenario: A regions zoom action is called when double clicked

behaviorTest('region-editing::35ddd908', () => {
  it('double-clicking a clip overlay bar calls onClipOverlayZoom with the region id', () => {
    const { container, onClipOverlayZoom } = renderTimeline()
    const bar = container.querySelector('.clip-overlay__bar')!
    expect(bar).not.toBeNull()
    fireEvent.doubleClick(bar)
    expect(onClipOverlayZoom).toHaveBeenCalledWith('r1')
  })
})

// region-editing::7a5597d1
// Scenario: A region when zoom action is called fills up the time bar

behaviorTest('region-editing::7a5597d1', () => {
  it('sets view to region bounds so the region fills 100% of the timeline', () => {
    const currentView = { start: 0, end: 120 }
    const { nextView } = calcZoomToRegion(currentView, 30, 60, null)
    expect(nextView).toEqual({ start: 30, end: 60 })
  })

  it('stashes the current view as previousView for restoration', () => {
    const currentView = { start: 0, end: 120 }
    const { previousView } = calcZoomToRegion(currentView, 30, 60, null)
    expect(previousView).toEqual(currentView)
  })
})

// region-editing::404dfafc
// Scenario: A region already zoomed when zoom action is called will zoom out

behaviorTest('region-editing::404dfafc', () => {
  it('viewFitsRegion detects when view matches region bounds', () => {
    expect(viewFitsRegion({ start: 30, end: 60 }, 30, 60)).toBe(true)
    expect(viewFitsRegion({ start: 30, end: 61 }, 30, 60)).toBe(false)
  })

  it('restores the previous view when called while already zoomed', () => {
    const savedView = { start: 0, end: 120 }
    const zoomedView = { start: 30, end: 60 }
    const { nextView, previousView } = calcZoomToRegion(zoomedView, 30, 60, savedView)
    expect(nextView).toEqual(savedView)
    expect(previousView).toBeNull()
  })

  it('falls back to current view when no saved view is available', () => {
    const zoomedView = { start: 30, end: 60 }
    const { nextView } = calcZoomToRegion(zoomedView, 30, 60, null)
    expect(nextView).toEqual(zoomedView)
  })
})
