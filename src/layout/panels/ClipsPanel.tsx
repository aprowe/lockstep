import { useCallback, useMemo, useState } from 'react'
import ListPanel from '../../components/list/ListPanel'
import ContextMenu, { type ContextMenuState } from '../../components/ContextMenu'
import ClipRow from './ClipRow'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  addRegion as addRegionAction,
  deleteRegion as deleteRegionAction,
  setActiveRegionId as setActiveRegionIdAction,
  updateRegionBeatTimes as updateRegionBeatTimesAction,
  renameRegion as renameRegionAction,
} from '../../store/slices/regionSlice'
import { setExportOpen as setExportOpenAction } from '../../store/slices/uiSlice'
import { setListSelection, setLastSelected } from '../../store/slices/listsSlice'
import { calcNewRegionBoundsFromScenes } from '../../utils/view'
import { useDockBridge } from '../DockContext'

/**
 * Clips list — first port of the shared list pattern. Multiselect lives in
 * lists.selection.clips; the single "active" clip (which drives the
 * timeline view) stays in regionSlice.activeRegionId. A plain click sets
 * both; shift/ctrl-click only touches selection.
 */
export default function ClipsPanel() {
  const dispatch = useAppDispatch()
  const { seek, pendingRenameId, setPendingRenameId } = useDockBridge()
  const video = useAppSelector(s => s.video.video)
  const regions = useAppSelector(s => s.region.regions)
  const activeRegionId = useAppSelector(s => s.region.activeRegionId)
  const playhead = useAppSelector(s => s.warp.playhead)
  const view = useAppSelector(s => s.ui.view)
  const warpBpm = useAppSelector(s => s.warp.bpm)
  const sceneCuts = useAppSelector(s => video ? s.scene.cutsByPath[video.path] ?? [] : [])
  const filterMode = useAppSelector(s => s.lists.filterMode.clips)

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Augment each region with the thumbnailTime the ListPanel needs, then
  // apply the active filter (clip-list ignores the 'clip' mode — that
  // would scope clips to themselves which is meaningless).
  const items = useMemo(() => {
    const augmented = regions.map(r => ({ ...r, thumbnailTime: r.inPoint }))
    if (filterMode === 'viewport') {
      return augmented.filter(r => r.outPoint > view.start && r.inPoint < view.end)
    }
    return augmented
  }, [regions, filterMode, view.start, view.end])

  const addRegion = useCallback((inPoint: number, outPoint: number) => {
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const name = `Clip ${regions.length + 1}`
    dispatch(addRegionAction({
      id, name, inPoint, outPoint,
      bpm: warpBpm, minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
    }))
    return id
  }, [dispatch, regions.length, warpBpm])

  const duplicateRegion = useCallback((srcId: string) => {
    const src = regions.find(r => r.id === srcId)
    if (!src || !video) return null
    const span = src.outPoint - src.inPoint
    const inPoint = Math.min(src.outPoint, video.duration - span)
    const outPoint = Math.min(inPoint + span, video.duration)
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    dispatch(addRegionAction({
      ...src, id, name: `Clip ${regions.length + 1}`, inPoint, outPoint,
      inBeatTime: undefined, outBeatTime: undefined,
    }))
    return id
  }, [dispatch, regions, video])

  // Active = the single clip a plain click landed on; also seeks the player.
  const onActivate = useCallback((id: string) => {
    dispatch(setActiveRegionIdAction(id))
    dispatch(setLastSelected({ list: 'clips', id }))
    const r = regions.find(x => x.id === id)
    if (r) seek(r.inPoint)
  }, [dispatch, regions, seek])

  const onDelete = useCallback((ids: string[]) => {
    for (const id of ids) dispatch(deleteRegionAction(id))
    dispatch(setListSelection({ list: 'clips', ids: [] }))
  }, [dispatch])

  const openContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation()
    const region = regions.find(r => r.id === id)
    if (!region) return
    setContextMenu({
      x: e.clientX, y: e.clientY,
      title: region.name,
      items: [
        { label: 'Rename',    action: () => { dispatch(setActiveRegionIdAction(id)); setPendingRenameId(id) } },
        { label: 'Duplicate', action: () => {
          const newId = duplicateRegion(id)
          if (newId) dispatch(setActiveRegionIdAction(newId))
        } },
        { label: 'Export',    action: () => { dispatch(setActiveRegionIdAction(id)); dispatch(setExportOpenAction(true)) } },
        { separator: true as const },
        {
          label: 'Reset boundaries',
          action: () => dispatch(updateRegionBeatTimesAction({ id, inBeatTime: undefined, outBeatTime: undefined })),
          disabled: region.inBeatTime === undefined && region.outBeatTime === undefined,
        },
        { label: 'Delete', action: () => dispatch(deleteRegionAction(id)), danger: true },
      ],
    })
  }, [regions, dispatch, duplicateRegion, setPendingRenameId])

  if (!video) return <div className="vj-empty-panel">No video</div>

  return (
    <>
      <ListPanel
        listId="clips"
        items={items}
        activeId={activeRegionId}
        onActivate={onActivate}
        onDelete={onDelete}
        hideClipFilter
        emptyHint="Drag on the strip to create a region"
        prefixRows={
          <div
            className={`clip-row clip-row--full${activeRegionId === null ? ' clip-row--active' : ''}`}
            onClick={() => {
              dispatch(setActiveRegionIdAction(null))
              dispatch(setListSelection({ list: 'clips', ids: [] }))
            }}
          >
            <span className="clip-row__swatch" style={{ background: 'var(--bg-5)' }} />
            <div className="clip-row__body">
              <div className="clip-row__name">Full Video</div>
            </div>
          </div>
        }
        headerActions={
          <button
            type="button"
            className="list-panel-add"
            title="New clip at playhead"
            onClick={() => {
              const { inPoint, outPoint } = calcNewRegionBoundsFromScenes(
                playhead, view, sceneCuts, video.duration,
              )
              addRegion(inPoint, outPoint)
            }}
          >+</button>
        }
        renderRow={(item, ctx) => {
          const colorIndex = regions.findIndex(r => r.id === item.id)
          return (
            <ClipRow
              key={item.id}
              region={item}
              colorIndex={colorIndex}
              ctx={ctx}
              pendingRename={pendingRenameId === item.id}
              onCommitRename={(id, name) => {
                dispatch(renameRegionAction({ id, name }))
                setPendingRenameId(null)
              }}
              onCancelRename={() => setPendingRenameId(null)}
              onContextMenu={e => openContextMenu(e, item.id)}
              onDoubleClick={() => setPendingRenameId(item.id)}
              onDelete={() => dispatch(deleteRegionAction(item.id))}
            />
          )
        }}
      />
      {contextMenu && (
        <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      )}
    </>
  )
}
