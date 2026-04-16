/**
 * Render harness for the Timeline component with clip overlays.
 * Returns the rendered container + any spy callbacks for assertions.
 */

import { render, type RenderResult } from '@testing-library/react'
import Timeline from '../../src/components/Timeline'
import type { ClipOverlay } from '../../src/components/Timeline'
import type { View } from '../../src/types'
import { vi } from 'vitest'

export interface RenderTimelineOptions {
  duration?: number
  view?: View
  clipOverlays?: ClipOverlay[]
  [key: string]: unknown
}

export function renderTimeline(overrides: RenderTimelineOptions = {}) {
  const onClipOverlayZoom = vi.fn()
  const onViewChange = vi.fn()

  const defaults = {
    duration: 120,
    anchors: [],
    view: { start: 0, end: 120 },
    onViewChange,
    clipOverlays: [
      { id: 'r1', name: 'Clip 1', inPoint: 30, outPoint: 60, active: true, colorIndex: 0 },
    ] as ClipOverlay[],
    onClipOverlayZoom,
  }

  const result = render(<Timeline {...defaults} {...overrides} />)

  return {
    ...result,
    onClipOverlayZoom,
    onViewChange,
  }
}
