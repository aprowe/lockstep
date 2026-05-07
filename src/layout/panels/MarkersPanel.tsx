import { useCallback, useMemo } from 'react'
import ListPanel from '../../components/list/ListPanel'
import { useFilteredItems } from '../../components/list/useFilteredItems'
import MarkerRow, { type MarkerRowData } from './MarkerRow'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { removeAnchors, setSelectedIds as setSelectedAnchorIds } from '../../store/slices/warpSlice'
import { selectActiveRegion, selectSelectedIdsSet, selectWarpData } from '../../store/selectors'
import { useDockBridge } from '../DockContext'

export default function MarkersPanel() {
  const dispatch = useAppDispatch()
  const { seek } = useDockBridge()
  const video = useAppSelector(s => s.video.video)
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
  const beatAnchors = useAppSelector(s => s.warp.beatAnchors)
  const warpBpm = useAppSelector(s => s.warp.bpm)
  const warpData = useAppSelector(selectWarpData)
  const activeRegion = useAppSelector(selectActiveRegion)
  const filterMode = useAppSelector(s => s.lists.filterMode.markers)
  // Markers selection lives in warp.selectedIds (number ids) so the
  // timeline lasso and the list stay in sync — same source of truth on
  // both sides. Stringified for ListPanel's id contract.
  const selectedAnchorIdSet = useAppSelector(selectSelectedIdsSet)
  const selectedIdsAsStrings = useMemo(
    () => new Set(Array.from(selectedAnchorIdSet, n => String(n))),
    [selectedAnchorIdSet],
  )

  // Build all rows up-front; let useFilteredItems window them by mode.
  const allItems = useMemo<MarkerRowData[]>(() => {
    if (!video) return []
    const beatZeroTime = warpData?.beatZeroTime ?? 0
    const beatDuration = warpBpm > 0 ? 60 / warpBpm : 0
    const sorted = [...origAnchors].sort((a, b) => a.time - b.time)
    return sorted.map((anchor, i) => {
      const beatAnchor = beatAnchors.find(b => b.id === anchor.id)
      const next = sorted[i + 1]
      const nextBeat = next ? beatAnchors.find(b => b.id === next.id) : null
      let stretch: number | null = null
      if (next && beatAnchor && nextBeat) {
        const origSpan = next.time - anchor.time
        const beatSpan = nextBeat.time - beatAnchor.time
        if (origSpan > 0) stretch = beatSpan / origSpan
      }
      return {
        id: String(anchor.id),
        anchorId: anchor.id,
        index: i + 1,
        time: anchor.time,
        thumbnailTime: anchor.time,
        fps: video.fps,
        beatNumber: beatAnchor && beatDuration > 0
          ? (beatAnchor.time - beatZeroTime) / beatDuration
          : null,
        isBeatZero: !!beatAnchor && Math.abs(beatAnchor.time - beatZeroTime) < 0.001,
        stretch,
      }
    })
  }, [video, origAnchors, beatAnchors, warpBpm, warpData])

  const items = useFilteredItems({
    items: allItems,
    filterMode,
    // Markers are points; range collapses to start === end at the anchor's time.
    getRange: useCallback((m: MarkerRowData) => ({ start: m.time, end: m.time }), []),
  })

  const onActivate = useCallback((id: string) => {
    const data = items.find(r => r.id === id)
    if (data) seek(data.time)
  }, [items, seek])

  const onDelete = useCallback((ids: string[]) => {
    dispatch(removeAnchors(ids.map(s => Number(s))))
    dispatch(setSelectedAnchorIds([]))
  }, [dispatch])

  const onSelectionChangeOverride = useCallback((ids: string[]) => {
    dispatch(setSelectedAnchorIds(ids.map(s => Number(s))))
  }, [dispatch])

  if (!video) return <div className="vj-empty-panel">No video</div>

  return (
    <ListPanel
      listId="markers"
      items={items}
      onActivate={onActivate}
      onDelete={onDelete}
      selectedIdsOverride={selectedIdsAsStrings}
      onSelectionChangeOverride={onSelectionChangeOverride}
      clipFilterDisabled={!activeRegion}
      emptyHint={
        filterMode === 'clip' && !activeRegion
          ? 'Select a clip to scope markers'
          : filterMode === 'clip'
            ? 'No markers in the active clip'
            : filterMode === 'viewport'
              ? 'No markers in view'
              : 'No markers placed'
      }
      renderRow={(item, ctx) => (
        <MarkerRow
          key={item.id}
          data={item}
          ctx={ctx}
          dim={!activeRegion || item.time < activeRegion.inPoint || item.time > activeRegion.outPoint}
          onDelete={() => dispatch(removeAnchors([item.anchorId]))}
          onDoubleClick={() => seek(item.time)}
        />
      )}
    />
  )
}
