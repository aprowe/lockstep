import { useCallback, useEffect, useMemo, useState } from 'react'
import ListPanel from '../../components/list/ListPanel'
import SceneRow, { type SceneRowData } from './SceneRow'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setMinGap as setSceneMinGapAction, deleteCut as deleteSceneCutAction } from '../../store/slices/sceneSlice'
import { detectScenesThunk, cancelSceneDetectionThunk } from '../../store/thunks/sceneThunks'
import { setView as setViewAction } from '../../store/slices/uiSlice'
import { setListSelection, setLastSelected } from '../../store/slices/listsSlice'
import { selectActiveRegion } from '../../store/selectors'
import { ensureTimeInView } from '../../utils/view'
import { filterCutsByMinGap } from '../../utils/sceneFilter'
import { useDockBridge } from '../DockContext'
import './ScenesPanel.css'

// Region color palette — must match clip-overlay--color-N in Timeline.css
// so a scene falling inside a clip shows the same hue as the clip overlay.
const REGION_PALETTE = [
  { h: 0,   s: 75, l: 55 },
  { h: 30,  s: 80, l: 52 },
  { h: 58,  s: 80, l: 48 },
  { h: 115, s: 65, l: 45 },
  { h: 183, s: 65, l: 42 },
  { h: 213, s: 70, l: 55 },
  { h: 270, s: 60, l: 55 },
  { h: 305, s: 65, l: 52 },
]

export default function ScenesPanel() {
  const dispatch = useAppDispatch()
  const { seek } = useDockBridge()
  const video = useAppSelector(s => s.video.video)
  const videoPath = video?.path ?? null
  const regions = useAppSelector(s => s.region.regions)
  const view = useAppSelector(s => s.ui.view)
  const cuts = useAppSelector(s => videoPath ? s.scene.cutsByPath[videoPath] ?? [] : [])
  const status = useAppSelector(s => videoPath ? s.scene.statusByPath[videoPath] ?? 'idle' : 'idle')
  const progress = useAppSelector(s => videoPath ? s.scene.progressByPath[videoPath] ?? 0 : 0)
  const error = useAppSelector(s => videoPath ? s.scene.errorByPath[videoPath] : undefined)
  const threshold = useAppSelector(s => videoPath ? s.scene.thresholdByPath[videoPath] : undefined) ?? 10
  const minGap = useAppSelector(s => videoPath ? s.scene.minGapByPath[videoPath] : undefined) ?? 2
  const filterMode = useAppSelector(s => s.lists.filterMode.scenes)
  const activeRegion = useAppSelector(selectActiveRegion)

  const [draftThreshold, setDraftThreshold] = useState(String(threshold))
  // Keep the threshold input in sync when upstream changes (e.g. new video).
  useEffect(() => { setDraftThreshold(String(threshold)) }, [threshold])
  const parsedThreshold = Number.parseFloat(draftThreshold)
  const thresholdChanged = Number.isFinite(parsedThreshold) && Math.abs(parsedThreshold - threshold) > 1e-3

  const filteredCuts = useMemo(() => filterCutsByMinGap(cuts, minGap), [cuts, minGap])

  // Boundaries 0 → ...cuts → duration become rows; each row spans [start, end).
  const items = useMemo<SceneRowData[]>(() => {
    if (!video) return []
    const boundaries = [0, ...filteredCuts, video.duration]
    const rows: SceneRowData[] = boundaries.slice(0, -1).map((start, i) => {
      const end = boundaries[i + 1]
      const regionIdx = regions.findIndex(r => start >= r.inPoint && start < r.outPoint)
      const regionColor = regionIdx >= 0 ? REGION_PALETTE[regionIdx % REGION_PALETTE.length] : null
      return {
        id: String(i),
        index: i,
        start, end,
        thumbnailTime: start,
        regionColor,
        // Boundary at t=0 is implied, not a real cut — disable its delete.
        canDelete: i > 0,
      }
    })
    if (filterMode === 'viewport') {
      return rows.filter(r => r.end > view.start && r.start < view.end)
    }
    if (filterMode === 'clip' && activeRegion) {
      return rows.filter(r =>
        r.end > activeRegion.inPoint && r.start < activeRegion.outPoint,
      )
    }
    return rows
  }, [video, filteredCuts, regions, filterMode, view.start, view.end, activeRegion])

  const onActivate = useCallback((id: string) => {
    const data = items.find(r => r.id === id)
    if (!data || !video) return
    seek(data.start)
    const next = ensureTimeInView(view, data.start, video.duration)
    if (next !== view) dispatch(setViewAction(next))
    dispatch(setLastSelected({ list: 'scenes', id }))
  }, [items, video, seek, view, dispatch])

  const onDelete = useCallback((ids: string[]) => {
    if (!videoPath) return
    for (const id of ids) {
      const row = items.find(r => r.id === id)
      if (row && row.canDelete) {
        dispatch(deleteSceneCutAction({ path: videoPath, cut: row.start }))
      }
    }
    dispatch(setListSelection({ list: 'scenes', ids: [] }))
  }, [items, videoPath, dispatch])

  if (!video) return <div className="vj-empty-panel">No video</div>

  const subHeader = (
    <>
      <div className="scenes-panel__row">
        <label className="scenes-panel__label">Threshold</label>
        <input
          type="number"
          className="scenes-panel__input"
          min={0} max={100} step={1}
          value={draftThreshold}
          onChange={e => setDraftThreshold(e.target.value)}
        />
        {/* Empty cell — keeps the threshold + min-gap rows column-aligned. */}
        <span />
        <button
          type="button"
          className="scenes-panel__btn"
          onClick={() => {
            const t = Number.parseFloat(draftThreshold)
            if (videoPath && Number.isFinite(t) && t >= 0) {
              dispatch(detectScenesThunk({ path: videoPath, threshold: t }))
            }
          }}
          disabled={status === 'analyzing'}
        >
          {thresholdChanged ? 'Apply' : 'Recompute'}
        </button>
      </div>
      <div className="scenes-panel__row">
        <label className="scenes-panel__label" title="Collapse cuts closer than this into one segment.">Min gap</label>
        <input
          type="number"
          className="scenes-panel__input"
          min={0} max={60} step={0.25}
          value={minGap}
          onChange={e => {
            if (!videoPath) return
            const v = Number.parseFloat(e.target.value)
            dispatch(setSceneMinGapAction({
              path: videoPath, minGap: Number.isFinite(v) && v >= 0 ? v : 0,
            }))
          }}
        />
        <span className="scenes-panel__unit">s</span>
        {/* No trailing button on this row — cell stays empty for alignment. */}
        <span />
      </div>
      {status === 'analyzing' && (
        <div className="scenes-panel__progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <div className="scenes-panel__progress-bar" style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }} />
          <span className="scenes-panel__progress-label">Analyzing… {Math.round(progress * 100)}%</span>
          <button
            type="button"
            className="scenes-panel__progress-cancel"
            onClick={() => dispatch(cancelSceneDetectionThunk())}
            title="Stop scene detection"
          >Stop</button>
        </div>
      )}
      {status === 'error' && error && (
        <div className="scenes-panel__error" title={error}>{error}</div>
      )}
    </>
  )

  return (
    <ListPanel
      listId="scenes"
      items={items}
      onActivate={onActivate}
      onDelete={onDelete}
      subHeader={subHeader}
      clipFilterDisabled={!activeRegion}
      emptyHint={
        status === 'analyzing'
          ? 'Analyzing…'
          : filterMode === 'clip' && !activeRegion
            ? 'Select a clip to scope scenes'
            : filterMode === 'clip'
              ? 'No scenes in the active clip'
              : filterMode === 'viewport'
                ? 'No scenes in view'
                : 'No scene cuts detected'
      }
      renderRow={(item, ctx) => (
        <SceneRow
          key={item.id}
          data={item}
          ctx={ctx}
          onDelete={() => {
            if (videoPath && item.canDelete) {
              dispatch(deleteSceneCutAction({ path: videoPath, cut: item.start }))
            }
          }}
        />
      )}
    />
  )
}
