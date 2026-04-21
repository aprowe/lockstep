/**
 * Render harness for the thin timeline region band with clip overlays.
 * Returns the rendered container + any spy callbacks for assertions.
 */

import { render, type RenderResult } from '@testing-library/react'
import RegionBand, { type RegionBlock } from '../../src/components/thin/RegionBand'
import type { View } from '../../src/types'
import { vi } from 'vitest'

export interface RenderTimelineOptions {
  duration?: number
  view?: View
  clipOverlays?: RegionBlock[]
  [key: string]: unknown
}

export function renderTimeline(overrides: RenderTimelineOptions = {}) {
  const onClipOverlayZoom = vi.fn()
  const onViewChange = vi.fn()

  const regions: RegionBlock[] = (overrides.clipOverlays as RegionBlock[] | undefined) ?? [
    { id: 'r1', label: 'Clip 1', inPoint: 30, outPoint: 60, active: true, colorIndex: 0 },
  ]
  const view: View = (overrides.view as View | undefined) ?? { start: 0, end: 120 }

  const result = render(
    <RegionBand
      label="Clip In"
      kind="input"
      regions={regions}
      view={view}
      onZoom={onClipOverlayZoom}
    />,
  )

  return {
    ...(result as RenderResult),
    onClipOverlayZoom,
    onViewChange,
  }
}
