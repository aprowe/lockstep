/**
 * Smoke tests for ClipInfoPanel's Alt-modifier stretch routing.
 *
 * Tests verify that committing a BPM or beats value:
 *   - dispatches applyBpmEdit / applyBeatsEdit with stretch=false by default
 *   - dispatches with stretch=true when Alt is held at commit time
 *
 * We render RegionInfoPanel directly (the pure presentation layer) with
 * vi.fn() callbacks instead of a real store, so we can assert the exact
 * arguments passed without Redux machinery.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react/pure'
import RegionInfoPanel from '../../../src/components/RegionInfoPanel'
import type { Region, WarpData } from '../../../src/types'

function makeRegion(overrides: Partial<Region> = {}): Region {
  const base = {
    id: 'r1',
    name: 'Clip A',
    inPoint: 0,
    outPoint: 10,
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,

    lockedBeats: 20,
    defaultLinked: true,
    ...overrides,
  }
  return {
    ...base,
    inBeatTime:  overrides.inBeatTime  ?? base.inPoint,
    outBeatTime: overrides.outBeatTime ?? base.outPoint,
  }
}

function makeWarpData(overrides: Partial<WarpData> = {}): WarpData {
  return {
    origAnchors: [],
    beatAnchors: [],
    bpm: 120,
    minStretch: 0.5,
    maxStretch: 2.0,
    ...overrides,
  }
}

function renderPanel(props: Partial<React.ComponentProps<typeof RegionInfoPanel>> = {}) {
  const defaults: React.ComponentProps<typeof RegionInfoPanel> = {
    activeRegion: makeRegion(),
    warpData: makeWarpData(),
    duration: 120,
    onBpmChange: vi.fn(),
  }
  return render(<RegionInfoPanel {...defaults} {...props} />)
}

describe('ClipInfoPanel — Alt modifier stretch routing', () => {
  afterEach(() => cleanup())

  describe('BPM input', () => {
    it('commits with stretch=false when Enter is pressed without Alt', () => {
      const onApplyBpmEdit = vi.fn()
      const { container } = renderPanel({ onApplyBpmEdit })
      const input = container.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '130' } })
      fireEvent.keyDown(input, { key: 'Enter', altKey: false })
      expect(onApplyBpmEdit).toHaveBeenCalledTimes(1)
      expect(onApplyBpmEdit).toHaveBeenCalledWith(130, false)
    })

    it('commits with stretch=true when Enter is pressed with Alt held', () => {
      const onApplyBpmEdit = vi.fn()
      const { container } = renderPanel({ onApplyBpmEdit })
      const input = container.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '140' } })
      fireEvent.keyDown(input, { key: 'Enter', altKey: true })
      expect(onApplyBpmEdit).toHaveBeenCalledTimes(1)
      expect(onApplyBpmEdit).toHaveBeenCalledWith(140, true)
    })

    it('commits with stretch=false on blur without Alt (no prior keyDown)', () => {
      const onApplyBpmEdit = vi.fn()
      const { container } = renderPanel({ onApplyBpmEdit })
      const input = container.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '115' } })
      // No keyDown — altHeldRef stays false; blur uses altKey ?? false → false
      fireEvent.blur(input, { altKey: false })
      expect(onApplyBpmEdit).toHaveBeenCalledWith(115, false)
    })

    it('commits with stretch=true on blur after keyDown with Alt held', () => {
      const onApplyBpmEdit = vi.fn()
      const { container } = renderPanel({ onApplyBpmEdit })
      const input = container.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '110' } })
      // Prime the ref via keyDown with altKey=true, then blur (not Enter)
      fireEvent.keyDown(input, { key: 'Tab', altKey: true })
      fireEvent.blur(input, {})
      expect(onApplyBpmEdit).toHaveBeenCalledWith(110, true)
    })

    it('falls back to onBpmChange when onApplyBpmEdit is not provided', () => {
      const onBpmChange = vi.fn()
      const { container } = renderPanel({ onBpmChange, onApplyBpmEdit: undefined })
      const input = container.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '100' } })
      fireEvent.keyDown(input, { key: 'Enter', altKey: false })
      expect(onBpmChange).toHaveBeenCalledWith(100)
    })
  })

  describe('Beats input', () => {
    it('commits with stretch=false when Enter is pressed without Alt', () => {
      const onApplyBeatsEdit = vi.fn()
      const { container } = renderPanel({ onApplyBeatsEdit })
      // Beats input is the second number input
      const inputs = container.querySelectorAll('input[type="number"]')
      const beatsInput = inputs[1] as HTMLInputElement
      fireEvent.change(beatsInput, { target: { value: '32' } })
      fireEvent.keyDown(beatsInput, { key: 'Enter', altKey: false })
      expect(onApplyBeatsEdit).toHaveBeenCalledTimes(1)
      expect(onApplyBeatsEdit).toHaveBeenCalledWith(32, false)
    })

    it('commits with stretch=true when Enter is pressed with Alt held', () => {
      const onApplyBeatsEdit = vi.fn()
      const { container } = renderPanel({ onApplyBeatsEdit })
      const inputs = container.querySelectorAll('input[type="number"]')
      const beatsInput = inputs[1] as HTMLInputElement
      fireEvent.change(beatsInput, { target: { value: '16' } })
      fireEvent.keyDown(beatsInput, { key: 'Enter', altKey: true })
      expect(onApplyBeatsEdit).toHaveBeenCalledTimes(1)
      expect(onApplyBeatsEdit).toHaveBeenCalledWith(16, true)
    })

    it('commits with stretch=false on blur without Alt (no prior keyDown)', () => {
      const onApplyBeatsEdit = vi.fn()
      const { container } = renderPanel({ onApplyBeatsEdit })
      const inputs = container.querySelectorAll('input[type="number"]')
      const beatsInput = inputs[1] as HTMLInputElement
      fireEvent.change(beatsInput, { target: { value: '24' } })
      fireEvent.blur(beatsInput, { altKey: false })
      expect(onApplyBeatsEdit).toHaveBeenCalledWith(24, false)
    })

    it('commits with stretch=true on blur after keyDown with Alt held', () => {
      const onApplyBeatsEdit = vi.fn()
      const { container } = renderPanel({ onApplyBeatsEdit })
      const inputs = container.querySelectorAll('input[type="number"]')
      const beatsInput = inputs[1] as HTMLInputElement
      fireEvent.change(beatsInput, { target: { value: '8' } })
      // Prime the ref via keyDown with altKey=true, then blur
      fireEvent.keyDown(beatsInput, { key: 'Tab', altKey: true })
      fireEvent.blur(beatsInput, {})
      expect(onApplyBeatsEdit).toHaveBeenCalledWith(8, true)
    })
  })
})

