import { useCallback, useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  removeAnchors,
  resetBeatLinks,
  setBeatAnchorsFromTimeline,
  setSelectedIds as setSelectedAnchorIdsAction,
} from '../../store/slices/warpSlice'
import {
  addRegion as addRegionAction,
  deleteRegion as deleteRegionAction,
  setActiveRegionId as setActiveRegionIdAction,
  updateRegionInOut as updateRegionInOutAction,
  updateRegionBeatTimes as updateRegionBeatTimesAction,
  renameRegion as renameRegionAction,
} from '../../store/slices/regionSlice'
import { setExportOpen as setExportOpenAction } from '../../store/slices/uiSlice'
import { setListSelection, setPendingEdit } from '../../store/slices/listsSlice'
import {
  deleteCut as deleteSceneCutAction,
  setSelectedCutTimes as setSelectedSceneCutTimesAction,
} from '../../store/slices/sceneSlice'
import { selectActiveRegion, selectSelectedIdsSet } from '../../store/selectors'
import { snapAllToBeat } from '../../utils/quantize'
import { formatTime } from '../../utils/time'
import { useDockBridge } from '../DockContext'
import './InspectorPanel.css'

/**
 * Bottom-left "what's selected" panel.
 *
 * Renders one section per non-empty selection bucket — clips, markers, scenes —
 * each with a small summary readout and the actions that make sense for that
 * kind of item (delete, snap to beat, export, duplicate, …). Selection lives
 * in three different slices today; this panel is the one place that reads them
 * all and acts on them in one place.
 */
export default function InspectorPanel() {
  const dispatch = useAppDispatch()
  const { seek } = useDockBridge()

  const video = useAppSelector(s => s.video.video)
  const videoPath = video?.path ?? null

  // ── Selection sources ────────────────────────────────────────────────
  const selectedClipIds = useAppSelector(s => s.lists.selection.clips)
  const selectedAnchorIdSet = useAppSelector(selectSelectedIdsSet)
  const selectedSceneTimes = useAppSelector(s => s.scene.selectedCutTimes)

  // ── Domain state we read for summaries ──────────────────────────────
  const regions = useAppSelector(s => s.region.regions)
  const activeRegion = useAppSelector(selectActiveRegion)
  const origAnchors = useAppSelector(s => s.warp.origAnchors)
  const beatAnchors = useAppSelector(s => s.warp.beatAnchors)
  const bpm = useAppSelector(s => s.warp.bpm)
  const beatZeroId = useAppSelector(s => s.warp.beatZeroId)
  const gridDiv = useAppSelector(s => s.ui.gridDiv)

  const selectedClips = useMemo(
    () => regions.filter(r => selectedClipIds.includes(r.id)),
    [regions, selectedClipIds],
  )

  const selectedAnchors = useMemo(
    () => origAnchors.filter(a => selectedAnchorIdSet.has(a.id)),
    [origAnchors, selectedAnchorIdSet],
  )

  // ── Beat offset (mirrors WarpView's logic) ──────────────────────────
  const beatOffset = useMemo(() => {
    if (!activeRegion) return beatAnchors[0]?.time ?? 0
    if (beatZeroId !== null) {
      const z = beatAnchors.find(a => a.id === beatZeroId)
      if (z) return z.time
    }
    return activeRegion.inBeatTime ?? activeRegion.inPoint
  }, [activeRegion, beatAnchors, beatZeroId])

  // ── Clip actions ─────────────────────────────────────────────────────
  const onDeleteClips = useCallback(() => {
    for (const id of selectedClipIds) dispatch(deleteRegionAction(id))
    dispatch(setListSelection({ list: 'clips', ids: [] }))
  }, [selectedClipIds, dispatch])

  const onDuplicateClips = useCallback(() => {
    if (!video) return
    const newIds: string[] = []
    for (const src of selectedClips) {
      const span = src.outPoint - src.inPoint
      const inPoint = Math.min(src.outPoint, video.duration - span)
      const outPoint = Math.min(inPoint + span, video.duration)
      const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      dispatch(addRegionAction({
        ...src, id, name: `${src.name} copy`, inPoint, outPoint,
        inBeatTime: undefined, outBeatTime: undefined,
      }))
      newIds.push(id)
    }
    if (newIds.length > 0) {
      dispatch(setActiveRegionIdAction(newIds[newIds.length - 1]))
      dispatch(setListSelection({ list: 'clips', ids: newIds }))
    }
  }, [selectedClips, video, dispatch])

  const onExportClips = useCallback(() => {
    // Export dialog reads activeRegionId + lists.selection.clips for batch
    // mode — we just need to make sure the right things are set before opening.
    if (selectedClipIds.length === 1) {
      dispatch(setActiveRegionIdAction(selectedClipIds[0]))
    }
    dispatch(setExportOpenAction(true))
  }, [selectedClipIds, dispatch])

  const onResetClipBoundaries = useCallback(() => {
    for (const id of selectedClipIds) {
      dispatch(updateRegionBeatTimesAction({ id, inBeatTime: undefined, outBeatTime: undefined }))
    }
  }, [selectedClipIds, dispatch])

  const onRenameClip = useCallback(() => {
    if (selectedClipIds.length !== 1) return
    const id = selectedClipIds[0]
    dispatch(setActiveRegionIdAction(id))
    dispatch(setPendingEdit({ list: 'clips', id }))
  }, [selectedClipIds, dispatch])

  // ── Marker actions ───────────────────────────────────────────────────
  const onDeleteMarkers = useCallback(() => {
    dispatch(removeAnchors([...selectedAnchorIdSet]))
    dispatch(setSelectedAnchorIdsAction([]))
  }, [selectedAnchorIdSet, dispatch])

  const onResetMarkerLinks = useCallback(() => {
    dispatch(resetBeatLinks([...selectedAnchorIdSet]))
  }, [selectedAnchorIdSet, dispatch])

  const onSnapMarkers = useCallback(() => {
    const beat = bpm > 0 ? (60 / bpm) / Math.max(1, gridDiv) : 0
    if (beat <= 0) return
    const toSnap = beatAnchors.filter(a => selectedAnchorIdSet.has(a.id))
    const snapped = snapAllToBeat(toSnap, beat, beatOffset)
    dispatch(setBeatAnchorsFromTimeline(
      beatAnchors.map(a => {
        const s = snapped.find(sa => sa.id === a.id)
        return s ? { ...a, time: s.time } : a
      }),
    ))
  }, [bpm, gridDiv, beatAnchors, beatOffset, selectedAnchorIdSet, dispatch])

  const onSendToNewRegion = useCallback(() => {
    if (selectedAnchors.length === 0) return
    const times = selectedAnchors.map(a => a.time)
    const inPoint = Math.min(...times)
    const outPoint = Math.max(...times)
    if (outPoint - inPoint < 0.001) return
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    dispatch(addRegionAction({
      id,
      name: `Clip ${regions.length + 1}`,
      inPoint, outPoint,
      bpm, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
  }, [selectedAnchors, regions.length, bpm, dispatch])

  // ── Scene actions ────────────────────────────────────────────────────
  const onDeleteScenes = useCallback(() => {
    if (!videoPath) return
    for (const t of selectedSceneTimes) {
      dispatch(deleteSceneCutAction({ path: videoPath, cut: t }))
    }
    dispatch(setSelectedSceneCutTimesAction([]))
  }, [selectedSceneTimes, videoPath, dispatch])

  const onSeekToScene = useCallback(() => {
    if (selectedSceneTimes.length !== 1) return
    seek(selectedSceneTimes[0])
  }, [selectedSceneTimes, seek])

  // ── Summaries ────────────────────────────────────────────────────────
  const clipSummary = useMemo(() => {
    if (selectedClips.length === 0) return null
    const totalDur = selectedClips.reduce((s, r) => s + (r.outPoint - r.inPoint), 0)
    const bpms = selectedClips.map(r => r.bpm).filter(b => b > 0)
    const allSameBpm = bpms.length > 0 && bpms.every(b => Math.abs(b - bpms[0]) < 0.01)
    return { count: selectedClips.length, totalDur, bpm: allSameBpm ? bpms[0] : null }
  }, [selectedClips])

  const markerSummary = useMemo(() => {
    if (selectedAnchors.length === 0) return null
    const times = selectedAnchors.map(a => a.time).sort((a, b) => a - b)
    const span = times.length > 1 ? times[times.length - 1] - times[0] : 0
    // Implied BPM from N selected markers spanning `span` seconds —
    // (N-1) intervals over span → (N-1) * 60 / span beats per minute.
    const impliedBpm = times.length > 1 && span > 0.001
      ? Math.round(((times.length - 1) * 60 / span) * 10) / 10
      : null
    return {
      count: selectedAnchors.length,
      first: times[0],
      last: times[times.length - 1],
      span,
      impliedBpm,
    }
  }, [selectedAnchors])

  const sceneSummary = useMemo(() => {
    if (selectedSceneTimes.length === 0) return null
    const times = [...selectedSceneTimes].sort((a, b) => a - b)
    const span = times.length > 1 ? times[times.length - 1] - times[0] : 0
    return { count: times.length, first: times[0], last: times[times.length - 1], span }
  }, [selectedSceneTimes])

  if (!video) return <div className="vj-empty-panel">No video</div>

  const nothingSelected = !clipSummary && !markerSummary && !sceneSummary

  return (
    <div className="inspector">
      {nothingSelected && (
        <div className="inspector__empty">
          <div className="inspector__empty-title">Nothing selected</div>
          <div className="inspector__empty-hint">
            Select clips, markers, or scene cuts to see details and actions here.
          </div>
        </div>
      )}

      {clipSummary && (
        <section className="inspector__section">
          <header className="inspector__heading">
            <span className="inspector__heading-label">Clips</span>
            <span className="inspector__heading-count">{clipSummary.count}</span>
          </header>
          <div className="inspector__rows">
            {selectedClips.length === 1 && (
              <Row label="Name" value={selectedClips[0].name} />
            )}
            <Row label="Duration" value={formatTime(clipSummary.totalDur)} />
            <Row
              label="BPM"
              value={clipSummary.bpm !== null ? clipSummary.bpm.toFixed(2) : 'mixed'}
              dim={clipSummary.bpm === null}
            />
          </div>
          <div className="inspector__actions">
            <button
              className="inspector__btn"
              onClick={onRenameClip}
              disabled={selectedClipIds.length !== 1}
              title="Rename clip"
            >Rename</button>
            <button className="inspector__btn" onClick={onDuplicateClips} title="Duplicate clip(s)">Duplicate</button>
            <button className="inspector__btn" onClick={onExportClips} title="Export the selected clip(s)">Export</button>
            <button
              className="inspector__btn"
              onClick={onResetClipBoundaries}
              title="Drop beat-space boundary overrides"
            >Reset boundaries</button>
            <button
              className="inspector__btn inspector__btn--danger"
              onClick={onDeleteClips}
              title="Delete selected clip(s)"
            >Delete</button>
          </div>
        </section>
      )}

      {markerSummary && (
        <section className="inspector__section">
          <header className="inspector__heading">
            <span className="inspector__heading-label">Markers</span>
            <span className="inspector__heading-count">{markerSummary.count}</span>
          </header>
          <div className="inspector__rows">
            {markerSummary.count === 1 ? (
              <Row label="Time" value={formatTime(markerSummary.first)} />
            ) : (
              <>
                <Row label="First" value={formatTime(markerSummary.first)} />
                <Row label="Last" value={formatTime(markerSummary.last)} />
                <Row label="Span" value={formatTime(markerSummary.span)} />
                <Row
                  label="Implied BPM"
                  value={markerSummary.impliedBpm !== null ? markerSummary.impliedBpm.toFixed(2) : '—'}
                  dim={markerSummary.impliedBpm === null}
                />
              </>
            )}
          </div>
          <div className="inspector__actions">
            <button className="inspector__btn" onClick={onSnapMarkers} title="Snap selected markers to beat grid">Snap to beat</button>
            <button className="inspector__btn" onClick={onResetMarkerLinks} title="Reset beat-anchor link to orig position">Reset link</button>
            <button
              className="inspector__btn"
              onClick={onSendToNewRegion}
              disabled={markerSummary.count < 2 || markerSummary.span < 0.001}
              title="Create a region spanning the selected markers"
            >Send to new clip</button>
            <button
              className="inspector__btn inspector__btn--danger"
              onClick={onDeleteMarkers}
              title="Delete selected markers"
            >Delete</button>
          </div>
        </section>
      )}

      {sceneSummary && (
        <section className="inspector__section">
          <header className="inspector__heading">
            <span className="inspector__heading-label">Scenes</span>
            <span className="inspector__heading-count">{sceneSummary.count}</span>
          </header>
          <div className="inspector__rows">
            {sceneSummary.count === 1 ? (
              <Row label="Time" value={formatTime(sceneSummary.first)} />
            ) : (
              <>
                <Row label="First" value={formatTime(sceneSummary.first)} />
                <Row label="Last" value={formatTime(sceneSummary.last)} />
                <Row label="Span" value={formatTime(sceneSummary.span)} />
              </>
            )}
          </div>
          <div className="inspector__actions">
            <button
              className="inspector__btn"
              onClick={onSeekToScene}
              disabled={sceneSummary.count !== 1}
              title="Seek the player to the cut"
            >Seek</button>
            <button
              className="inspector__btn inspector__btn--danger"
              onClick={onDeleteScenes}
              title="Delete selected scene cuts"
            >Delete</button>
          </div>
        </section>
      )}
    </div>
  )
}

interface RowProps {
  label: string
  value: React.ReactNode
  dim?: boolean
}

function Row({ label, value, dim }: RowProps) {
  return (
    <div className="inspector__row">
      <span className="inspector__label">{label}</span>
      <span className={`inspector__value${dim ? ' inspector__value--dim' : ''}`}>{value}</span>
    </div>
  )
}
