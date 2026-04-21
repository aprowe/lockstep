import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react/pure'
import MarkersTrack from '../../../src/components/thin/MarkersTrack'
import BarsTrack from '../../../src/components/thin/BarsTrack'
import BeatsTrack from '../../../src/components/thin/BeatsTrack'
import RegionBand from '../../../src/components/thin/RegionBand'

const VIEW = { start: 0, end: 100 }

function stubRect(el: HTMLElement, left = 0, width = 1000) {
  el.getBoundingClientRect = () => ({
    left, top: 0, right: left + width, bottom: 18,
    width, height: 18, x: left, y: 0, toJSON: () => ({}),
  }) as DOMRect
}

describe('thin tracks', () => {
  afterEach(() => cleanup())

  describe('MarkersTrack', () => {
    it('positions anchors by view percentage', () => {
      const { container } = render(
        <MarkersTrack
          anchors={[{ id: 1, time: 25 }, { id: 2, time: 75 }]}
          view={VIEW}
          duration={100}
          selectedIds={new Set()}
        />
      )
      const markers = container.querySelectorAll('.thin-marker')
      expect(markers.length).toBe(2)
      expect((markers[0] as HTMLElement).style.left).toBe('25%')
      expect((markers[1] as HTMLElement).style.left).toBe('75%')
    })

    it('double-click on background fires onAdd with the scaled time', () => {
      const onAdd = vi.fn<(t: number) => void>()
      const { container } = render(
        <MarkersTrack
          anchors={[]}
          view={VIEW}
          duration={100}
          selectedIds={new Set()}
          onAdd={onAdd}
        />
      )
      // .thin-row__body (from TrackRow) is the real click surface — the inner
      // .thin-markers__body has no CSS and collapses to 0 height in browsers.
      const body = container.querySelector('.thin-row__body') as HTMLElement
      stubRect(body, 0, 1000)
      fireEvent.doubleClick(body, { clientX: 400 })
      expect(onAdd).toHaveBeenCalledTimes(1)
      expect(onAdd.mock.calls[0][0]).toBeCloseTo(40, 1)
    })

    it('click on a marker seeks + selects it (not add)', () => {
      const onAdd = vi.fn()
      const onSeek = vi.fn<(t: number) => void>()
      const onSelect = vi.fn<(id: number, additive: boolean) => void>()
      const { container } = render(
        <MarkersTrack
          anchors={[{ id: 7, time: 42 }]}
          view={VIEW}
          duration={100}
          selectedIds={new Set()}
          onAdd={onAdd}
          onSeek={onSeek}
          onSelect={onSelect}
        />
      )
      const marker = container.querySelector('.thin-marker') as HTMLElement
      fireEvent.click(marker)
      expect(onAdd).not.toHaveBeenCalled()
      expect(onSeek).toHaveBeenCalledWith(42)
      expect(onSelect).toHaveBeenCalledWith(7, false)
    })

    it('shift-click deletes instead of seeking', () => {
      const onSeek = vi.fn()
      const onDelete = vi.fn<(id: number) => void>()
      const { container } = render(
        <MarkersTrack
          anchors={[{ id: 3, time: 10 }]}
          view={VIEW}
          duration={100}
          selectedIds={new Set()}
          onSeek={onSeek}
          onDelete={onDelete}
        />
      )
      const marker = container.querySelector('.thin-marker') as HTMLElement
      fireEvent.click(marker, { shiftKey: true })
      expect(onDelete).toHaveBeenCalledWith(3)
      expect(onSeek).not.toHaveBeenCalled()
    })
  })

  describe('BarsTrack', () => {
    it('renders bar ticks at bpm-derived positions', () => {
      // bpm 120 → 0.5s/beat → 2s/bar. View [0..20s] → 10 bars.
      const { container } = render(
        <BarsTrack view={{ start: 0, end: 20 }} duration={20} bpm={120} />
      )
      const bars = container.querySelectorAll('.thin-bar')
      expect(bars.length).toBeGreaterThan(5)
      expect(bars.length).toBeLessThanOrEqual(15)
    })

    it('renders nothing when view is too wide to be readable', () => {
      // bpm 120 → 2s/bar; 400s view → 200 bars > threshold (120).
      const { container } = render(
        <BarsTrack view={{ start: 0, end: 400 }} duration={400} bpm={120} />
      )
      expect(container.querySelectorAll('.thin-bar').length).toBe(0)
    })
  })

  describe('BeatsTrack', () => {
    it('renders a beat per 60/bpm seconds', () => {
      // bpm 120 → 0.5s/beat. View [0..5s] → ~10 beats visible.
      const { container } = render(
        <BeatsTrack view={{ start: 0, end: 5 }} duration={5} bpm={120} />
      )
      const beats = container.querySelectorAll('.thin-beat')
      expect(beats.length).toBeGreaterThanOrEqual(8)
      expect(beats.length).toBeLessThanOrEqual(12)
    })

    it('marks every 4th beat as a downbeat', () => {
      const { container } = render(
        <BeatsTrack view={{ start: 0, end: 5 }} duration={5} bpm={120} />
      )
      const downbeats = container.querySelectorAll('.thin-beat--downbeat')
      expect(downbeats.length).toBeGreaterThanOrEqual(2)
    })

    it('hides beats entirely when view is too wide', () => {
      // bpm 120 → 0.5s/beat; 1000s view → 2000 beats > threshold.
      const { container } = render(
        <BeatsTrack view={{ start: 0, end: 1000 }} duration={1000} bpm={120} />
      )
      expect(container.querySelectorAll('.thin-beat').length).toBe(0)
    })
  })

  describe('RegionBand', () => {
    it('positions and sizes blocks by view pct', () => {
      const { container } = render(
        <RegionBand
          kind="input"
          regions={[{ id: 'a', inPoint: 20, outPoint: 60, colorIndex: 3 }]}
          view={VIEW}
        />
      )
      const block = container.querySelector('.thin-region') as HTMLElement
      expect(block).not.toBeNull()
      expect(block.style.left).toBe('20%')
      expect(block.style.width).toBe('40%')
      expect(block.className).toContain('clip-overlay--color-3')
    })
  })
})
