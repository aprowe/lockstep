/**
 * Render harness for the RegionSidebar (clip list).
 * Returns the rendered container + spy callbacks for assertions.
 */

import { render, type RenderResult } from '@testing-library/react/pure'
import { vi } from 'vitest'
import RegionSidebar from '../../src/components/RegionSidebar'
import type { Region } from '../../src/types'

export interface RenderRegionSidebarOptions {
  duration?: number
  regions?: Region[]
  activeRegionId?: string | null
}

const makeRegion = (id: string, name: string, inP: number, outP: number): Region => ({
  id, name, inPoint: inP, outPoint: outP,
  bpm: 120, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
})

export function renderRegionSidebar(opts: RenderRegionSidebarOptions = {}) {
  const onSelectRegion = vi.fn()
  const onAddRegion = vi.fn()
  const onDeleteRegion = vi.fn()
  const onRename = vi.fn()
  const onUpdateInOut = vi.fn()

  const result = render(
    <RegionSidebar
      duration={opts.duration ?? 120}
      regions={opts.regions ?? [makeRegion('r1', 'Verse', 30, 45)]}
      activeRegionId={opts.activeRegionId ?? null}
      onSelectRegion={onSelectRegion}
      onAddRegion={onAddRegion}
      onDeleteRegion={onDeleteRegion}
      onRename={onRename}
      onUpdateInOut={onUpdateInOut}
    />,
  )

  return {
    ...(result as RenderResult),
    onSelectRegion,
    onAddRegion,
    onDeleteRegion,
    onRename,
    onUpdateInOut,
  }
}

export { makeRegion }
