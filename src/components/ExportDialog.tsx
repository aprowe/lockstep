import { useEffect, useMemo, useRef, useState } from 'react'
import type { WarpData, Region } from '../types'
import { startWarp, listenWarpProgress, saveOutput, pickExportFolder, saveToFolder, writeTextFile, revealInFolder } from '../api/warp'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { setLastExportFolder, setExportProgress, resetExportProgress } from '../store/slices/uiSlice'
import { buildWarpRequest, type AudioMode } from '../utils/exportRequest'
import { visibleSceneCuts } from '../utils/sceneFilter'
import './ExportDialog.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExportJob {
  label: string
  clipIn: number | null
  clipOut: number | null
  bpm: number
  addToEnd: boolean
  triggerMode?: boolean
  /** Beat count for filename interpolation. For region jobs this is the
   *  region span at its bpm; null falls back to the global loop-beats. */
  beats: number | null
  /** 0-based index of the source region within the *full* regions list, so
   *  `{n}` in the filename pattern stays stable even when exporting a subset.
   *  -1 for non-region jobs (full-video export). */
  regionIndex: number
}

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  warpData: WarpData | null
  videoPath: string
  originalName: string
  videoFps?: number
  loopBeats: number | null
  addToEnd: boolean
  trimToLoop: boolean
  regions: Region[]
  activeRegionId: string | null
  /** Clip ids selected on the timeline / clips list. When the dialog opens
   *  with a non-empty selection we auto-switch into 'selected' mode and
   *  pre-check those ids, so "export selected" is one click. */
  selectedClipIds?: readonly string[]
}

type ExportMode = 'current' | 'all' | 'selected'
type InterpMethod = 'minterpolate' | 'rife'

// ── Name pattern helpers ──────────────────────────────────────────────────────

/**
 * Available tokens: {name} {stem} {bpm} {beats} {in} {out} {n}
 * `n` is the 1-based index of the source clip within the full regions list
 * (so export order / filtering doesn't renumber it).
 */
function applyPattern(pattern: string, opts: {
  name: string
  stem: string
  bpm: number
  beats: number | null
  clipIn: number | null
  clipOut: number | null
  /** 1-based clip number; 0 means "not a region" (full video). */
  clipNumber: number
}): string {
  const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0')
  const fmtSec = (s: number | null) => {
    if (s === null) return '0'
    const m = Math.floor(s / 60), sec = s % 60
    return m > 0 ? `${m}m${pad2(sec)}s` : `${Math.floor(sec)}s`
  }
  return pattern
    .replace(/\{name\}/g, opts.name.replace(/\s+/g, '_'))
    .replace(/\{stem\}/g, opts.stem.replace(/\s+/g, '_'))
    .replace(/\{bpm\}/g, String(Math.round(opts.bpm)))
    .replace(/\{beats\}/g, opts.beats !== null ? String(opts.beats) : '')
    .replace(/\{in\}/g, fmtSec(opts.clipIn))
    .replace(/\{out\}/g, fmtSec(opts.clipOut))
    .replace(/\{n\}/g, String(Math.max(1, opts.clipNumber)).padStart(2, '0'))
}

// ── Marker sidecar ────────────────────────────────────────────────────────────

function buildMarkerJson(warpData: WarpData, opts: {
  videoName: string
  exportFolder: string | null
}): string {
  const { origAnchors, beatAnchors, bpm, minStretch, maxStretch, addToEnd, beatZeroTime } = warpData
  return JSON.stringify({
    videoName: opts.videoName,
    exportFolder: opts.exportFolder,
    origAnchors, beatAnchors, bpm, minStretch, maxStretch, addToEnd, beatZeroTime,
  }, null, 2)
}

/** Given a saved video path like /foo/bar.mp4, writes /foo/bar.json */
async function writeMarkerSidecar(videoPath: string, warpData: WarpData, opts: {
  videoName: string
  exportFolder: string | null
}): Promise<void> {
  const jsonPath = videoPath.replace(/\.[^.]+$/, '.json')
  await writeTextFile(jsonPath, buildMarkerJson(warpData, opts))
}

/** Extract parent folder from a file path (works with / and \) */
function parentFolder(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx > 0 ? filePath.substring(0, idx) : filePath
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExportDialog({
  open, onClose, warpData, videoPath, originalName, videoFps,
  loopBeats, addToEnd, trimToLoop, regions, activeRegionId,
  selectedClipIds,
}: ExportDialogProps) {
  const [fadeAtLoop, setFadeAtLoop] = useState(false)
  const [normalizeBpm, setNormalizeBpm] = useState(false)
  const [normBpmTarget, setNormBpmTarget] = useState(120)
  const [interpolateFrames, setInterpolateFrames] = useState(false)
  const [interpMethod, setInterpMethod] = useState<InterpMethod>('minterpolate')
  const [interpFps, setInterpFps] = useState(() => Math.round(videoFps ?? 60))
  // Audio export mode. `includeAudio` toggles whether the muxer writes an
  // audio stream at all; when on, `pitchAudio` decides between the classic
  // pitch-preserving atempo path ('tempo') and the new turntable-style
  // asetrate path ('pitch') that pitches up/down with the video speed.
  const [includeAudio, setIncludeAudio] = useState(true)
  const [pitchAudio, setPitchAudio] = useState(false)
  const audioMode: AudioMode = !includeAudio ? 'none' : pitchAudio ? 'pitch' : 'tempo'
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [currentJobLabel, setCurrentJobLabel] = useState('')
  const [currentJobIdx, setCurrentJobIdx] = useState(0)
  const [totalJobs, setTotalJobs] = useState(0)
  const [currentMessage, setCurrentMessage] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [outputPaths, setOutputPaths] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [savedFolder, setSavedFolder] = useState<string | null>(null)
  const unlistenRef = useRef<UnlistenFn | null>(null)
  const cancelRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // Guards the "click outside the dialog closes it" behavior: only close when
  // the press STARTED on the overlay. Without this, selecting text inside an
  // input and releasing the mouse outside the dialog bubbles up to the overlay
  // (the common ancestor of mousedown/mouseup) and fires handleClose.
  const mousedownOnOverlay = useRef(false)

  const [mode, setMode] = useState<ExportMode>('current')
  const [selectedRegionIds, setSelectedRegionIds] = useState<Set<string>>(new Set())

  const reduxDispatch = useAppDispatch()
  const lastExportFolder = useAppSelector(s => s.ui.lastExportFolder)
  const detectedSceneCuts = useAppSelector(s => (videoPath ? s.scene?.cutsByPath?.[videoPath] ?? [] : []))
  const userSceneCuts = useAppSelector(s => (videoPath ? s.scene?.userCutsByPath?.[videoPath] ?? [] : []))
  const sceneMinGap = useAppSelector(s => (videoPath ? s.scene?.minGapByPath?.[videoPath] : undefined)) ?? 2
  // Export uses the visible cut set (filtered detected ∪ user-placed) so the
  // backend processes the same boundaries the operator sees in the UI.
  const sceneCuts = useMemo(
    () => visibleSceneCuts(detectedSceneCuts, userSceneCuts, sceneMinGap),
    [detectedSceneCuts, userSceneCuts, sceneMinGap],
  )

  // Output settings — default folder is last-used export folder, then video's parent folder
  const videoFolder = useMemo(() => videoPath ? parentFolder(videoPath) : null, [videoPath])
  const destFolder = lastExportFolder ?? videoFolder
  const [namePattern, setNamePattern] = useState('{stem}_clip{n}_{bpm}bpm_{beats}b')
  const baseName = originalName.replace(/\.[^.]+$/, '')  // stem of source video

  useEffect(() => {
    // Do not reset if a background export is in progress — the user may be
    // reopening the dialog to see its progress.
    if (open && status !== 'processing') {
      setStatus('idle')
      setProgress(0)
      setError(null)
      setOutputPaths([])
      setSavedCount(0)
      setSavedFolder(null)
      setCurrentJobIdx(0)
      setTotalJobs(0)
      setCurrentMessage('')
      setLogLines([])
      cancelRef.current = false
      // Prefer the timeline's clip selection when the dialog opens: switch
      // into 'selected' mode and pre-check exactly those ids. Filter by the
      // live regions list so stale ids can't end up in the checked set. If
      // nothing is selected, fall back to the old default (every region
      // checked, caller picks a mode).
      const preSelected = (selectedClipIds ?? [])
        .filter(id => regions.some(r => r.id === id))
      if (preSelected.length > 0) {
        setMode('selected')
        setSelectedRegionIds(new Set(preSelected))
      } else {
        setSelectedRegionIds(new Set(regions.map(r => r.id)))
      }
      setInterpFps(Math.round(videoFps ?? 60))
    }
  }, [open, regions, videoFps, selectedClipIds]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { unlistenRef.current?.() }, [])

  // Mirror local processing state into Redux so the top-right progress bar can
  // render it while this dialog is closed.
  useEffect(() => {
    reduxDispatch(setExportProgress({
      status,
      progress,
      label: currentJobLabel,
      jobIdx: currentJobIdx,
      totalJobs,
      message: currentMessage,
      error,
    }))
  }, [status, progress, currentJobLabel, currentJobIdx, totalJobs, currentMessage, error, reduxDispatch])

  // Clear redux progress once the user dismisses the dialog after a finished run.
  useEffect(() => {
    if (!open && (status === 'done' || status === 'error' || status === 'idle')) {
      reduxDispatch(resetExportProgress())
    }
  }, [open, status, reduxDispatch])

  // Auto-scroll the log to the latest line as it grows.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logLines])

  useEffect(() => {
    if (!open) return
    // Capture phase + stopImmediatePropagation so Escape closes this modal
    // without also firing the menu-bar "Escape → Deselect" shortcut.
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeRegion = regions.find(r => r.id === activeRegionId) ?? null
  const bpm = warpData?.bpm ?? 120
  // Allow export even with no markers (passthrough / cut only)
  const canProcess = !!warpData || (videoPath.length > 0)

  const beatsForRegion = (r: { inPoint: number; outPoint: number; bpm: number } | null): number | null => {
    if (!r) return loopBeats
    const span = Math.max(0, r.outPoint - r.inPoint)
    if (span <= 0 || !(r.bpm > 0)) return loopBeats
    return Math.round(span * r.bpm / 60)
  }

  const buildJobs = (): ExportJob[] => {
    if (mode === 'current') {
      const activeIdx = activeRegion
        ? regions.findIndex(r => r.id === activeRegion.id)
        : -1
      return [{
        label: activeRegion ? activeRegion.name : baseName,
        clipIn: activeRegion?.inPoint ?? null,
        clipOut: activeRegion?.outPoint ?? null,
        bpm: activeRegion?.bpm ?? bpm,
        addToEnd: activeRegion?.addToEnd ?? addToEnd,
        triggerMode: activeRegion?.triggerMode ?? false,
        beats: beatsForRegion(activeRegion),
        regionIndex: activeIdx,
      }]
    }
    const list = mode === 'all' ? regions : regions.filter(r => selectedRegionIds.has(r.id))
    if (list.length === 0) {
      return [{
        label: baseName,
        clipIn: null,
        clipOut: null,
        bpm,
        addToEnd,
        beats: loopBeats,
        regionIndex: -1,
      }]
    }
    return list.map(r => ({
      label: r.name,
      clipIn: r.inPoint,
      clipOut: r.outPoint,
      bpm: r.bpm,
      addToEnd: r.addToEnd,
      triggerMode: r.triggerMode ?? false,
      beats: beatsForRegion(r),
      // {n} should track the clip's position in the *full* list, not in the
      // filtered export subset — exporting clips 2 and 5 should still yield
      // _clip02_ and _clip05_ in the filenames.
      regionIndex: regions.findIndex(rr => rr.id === r.id),
    }))
  }

  const getFileName = (job: ExportJob, index: number) => {
    // Filename BPM must reflect the *output* BPM, not the source — backend
    // normalizes to 120 when `normalizeBpm` is on, so the file we ship is at
    // 120bpm regardless of the region's authored tempo.
    const effectiveBpm = normalizeBpm ? normBpmTarget : job.bpm
    const clipNumber = job.regionIndex >= 0 ? job.regionIndex + 1 : index + 1
    const name = applyPattern(namePattern, {
      name: job.label,
      stem: baseName,
      bpm: effectiveBpm,
      beats: job.beats,
      clipIn: job.clipIn,
      clipOut: job.clipOut,
      clipNumber,
    })
    return `${name}.mp4`
  }

  const process = async () => {
    if (!videoPath) return
    const jobs = buildJobs()
    setStatus('processing')
    setTotalJobs(jobs.length)
    setOutputPaths([])
    setError(null)
    setSavedFolder(destFolder)
    setSavedCount(0)
    setLogLines([])
    setCurrentMessage('')
    cancelRef.current = false

    const results: string[] = []
    let savedSoFar = 0
    let firstError: string | null = null

    for (let i = 0; i < jobs.length; i++) {
      if (cancelRef.current) break
      const job = jobs[i]
      setCurrentJobIdx(i)
      setCurrentJobLabel(job.label)
      setProgress(0)
      setCurrentMessage('')
      if (jobs.length > 1) {
        setLogLines(prev => [...prev, `── ${job.label} (${i + 1}/${jobs.length}) ──`])
      }

      try {
        const jobId = await startWarp(buildWarpRequest({
          videoPath,
          warpData,
          job,
          loopBeats,
          trimToLoop,
          fadeAtLoop,
          normalizeBpm,
          interpolateFrames,
          interpFps,
          interpMethod,
          sceneCuts,
          audioMode,
        }))

        const outputPath = await new Promise<string>((resolve, reject) => {
          listenWarpProgress(payload => {
            if (payload.job_id !== jobId) return
            setProgress(payload.percent ?? 0)
            const msg = payload.message
            if (msg) {
              setCurrentMessage(msg)
              // Dedupe consecutive duplicate messages — the backend can emit
              // the same label many times per stage (e.g. per RIFE frame).
              setLogLines(prev =>
                prev.length > 0 && prev[prev.length - 1] === msg ? prev : [...prev, msg]
              )
            }
            if (payload.status === 'done' && payload.output_path) {
              unlistenRef.current?.()
              resolve(payload.output_path)
            }
            if (payload.status === 'error') {
              unlistenRef.current?.()
              reject(new Error(payload.error ?? 'Unknown error'))
            }
          }).then(ul => { unlistenRef.current = ul })
        })

        results.push(outputPath)
        setOutputPaths([...results])

        // Land the rendered file in the destination folder immediately, before
        // moving on to the next render. Earlier behavior queued every clip and
        // copied them only after the full batch finished, which delayed
        // visibility (and lost everything if a later clip aborted the run).
        if (destFolder) {
          try {
            await saveToFolder({ source_path: outputPath, dest_folder: destFolder, file_name: getFileName(job, i) })
            savedSoFar += 1
            setSavedCount(savedSoFar)
          } catch (e: any) {
            const msg = `${job.label} (save): ${e.message ?? String(e)}`
            if (!firstError) firstError = msg
            setLogLines(prev => [...prev, `ERROR — ${msg}`])
          }
        }
      } catch (e: any) {
        const msg = `${job.label}: ${e.message ?? String(e)}`
        if (!firstError) firstError = msg
        setLogLines(prev => [...prev, `ERROR — ${msg}`])
        // Continue with the remaining jobs — earlier successes stay saved.
      }
    }

    if (cancelRef.current) return

    if (firstError) {
      setStatus('error')
      setError(firstError)
    } else {
      setStatus('done')
    }
  }

  const handleSaveOne = async (idx: number) => {
    const path = outputPaths[idx]
    if (!path) return
    setSaving(true)
    try {
      const jobs = buildJobs()
      const fileName = getFileName(jobs[idx], idx)
      let savedPath: string
      if (destFolder) {
        savedPath = await saveToFolder({ source_path: path, dest_folder: destFolder, file_name: fileName })
      } else {
        savedPath = await saveOutput({ source_path: path, suggested_name: fileName })
      }
      if (warpData) await writeMarkerSidecar(savedPath, warpData, { videoName: originalName, exportFolder: destFolder })
      setSavedCount(prev => prev + 1)
      setSavedFolder(parentFolder(savedPath))
    } catch (e: any) {
      if (!String(e).includes('cancelled')) setError(e.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAll = async () => {
    setSaving(true)
    try {
      const jobs = buildJobs()
      let lastFolder: string | null = null
      for (let i = 0; i < outputPaths.length; i++) {
        const fileName = getFileName(jobs[i], i)
        let savedPath: string
        if (destFolder) {
          savedPath = await saveToFolder({ source_path: outputPaths[i], dest_folder: destFolder, file_name: fileName })
        } else {
          savedPath = await saveOutput({ source_path: outputPaths[i], suggested_name: fileName })
        }
        if (warpData) await writeMarkerSidecar(savedPath, warpData, { videoName: originalName, exportFolder: destFolder })
        lastFolder = parentFolder(savedPath)
      }
      setSavedCount(outputPaths.length)
      if (lastFolder) setSavedFolder(lastFolder)
    } catch (e: any) {
      if (!String(e).includes('cancelled')) setError(e.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const handlePickFolder = async () => {
    try {
      const folder = await pickExportFolder()
      reduxDispatch(setLastExportFolder(folder))
    } catch {
      // cancelled
    }
  }

  // Close hides the dialog but leaves any in-flight processing running in the
  // background (progress is mirrored to Redux and shown in the top-right bar).
  const handleClose = () => {
    onClose()
  }

  const handleCancel = () => {
    cancelRef.current = true
  }

  const toggleRegion = (id: string) => {
    setSelectedRegionIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Keep the dialog mounted so processing survives close. Hide via CSS when
  // !open; this preserves local state (log lines, listener refs, cancelRef).
  const hasRegions = regions.length > 0
  const jobs = buildJobs()
  const previewName = jobs.length > 0 ? getFileName(jobs[0], 0) : ''

  return (
    <div
      className="export-overlay"
      ref={overlayRef}
      style={{ display: open ? undefined : 'none' }}
      onMouseDown={e => { mousedownOnOverlay.current = e.target === overlayRef.current }}
      onMouseUp={e => {
        if (mousedownOnOverlay.current && e.target === overlayRef.current) handleClose()
        mousedownOnOverlay.current = false
      }}
    >
      <div className="export-dialog">

        <div className="export-dialog__header">
          <span className="export-dialog__title">Export</span>
          <div className="export-dialog__header-actions">
            {status === 'processing' && (
              <button
                className="export-dialog__close"
                onClick={handleCancel}
                title="Stop processing"
              >
                Cancel
              </button>
            )}
            <button className="export-dialog__close" onClick={handleClose} title="Close">
              ✕
            </button>
          </div>
        </div>

        <div className="export-dialog__body">

          {/* Clip mode selector */}
          {hasRegions && status === 'idle' && (
            <div className="export-dialog__modes">
              <button
                className={`export-dialog__mode${mode === 'current' ? ' export-dialog__mode--active' : ''}`}
                onClick={() => setMode('current')}
                title={activeRegion ? activeRegion.name : 'No Clip'}
              >
                {activeRegion ? activeRegion.name : 'No Clip'}
              </button>
              <button
                className={`export-dialog__mode${mode === 'all' ? ' export-dialog__mode--active' : ''}`}
                onClick={() => setMode('all')}
                aria-label="All Regions"
              >
                All ({regions.length})
              </button>
              <button
                className={`export-dialog__mode${mode === 'selected' ? ' export-dialog__mode--active' : ''}`}
                onClick={() => setMode('selected')}
              >
                Select
              </button>
            </div>
          )}

          {/* Clip selector */}
          {mode === 'selected' && status === 'idle' && (
            <div className="export-dialog__clip-list">
              {regions.map(r => (
                <label key={r.id} className="export-dialog__clip-item">
                  <input
                    type="checkbox"
                    checked={selectedRegionIds.has(r.id)}
                    onChange={() => toggleRegion(r.id)}
                  />
                  <span className="export-dialog__clip-name">{r.name}</span>
                  <span className="export-dialog__clip-bpm">{Math.round(r.bpm)}</span>
                </label>
              ))}
            </div>
          )}

          {/* Output folder + name pattern */}
          {status === 'idle' && (
            <div className="export-dialog__output">
              <div className="export-dialog__row">
                <span className="export-dialog__row-label">Folder</span>
                <input
                  className="export-dialog__folder-input"
                  value={destFolder ?? ''}
                  onChange={e => reduxDispatch(setLastExportFolder(e.target.value || null))}
                  placeholder="Choose folder…"
                  spellCheck={false}
                />
                <button
                  className="export-dialog__folder-browse"
                  onClick={handlePickFolder}
                  title="Browse…"
                >…</button>
                {lastExportFolder && (
                  <button className="export-dialog__folder-clear" onClick={() => reduxDispatch(setLastExportFolder(null))} title="Reset to video folder">✕</button>
                )}
              </div>
              <div className="export-dialog__row">
                <span className="export-dialog__row-label">Name</span>
                <input
                  className="export-dialog__pattern"
                  aria-label="Filename Pattern"
                  value={namePattern}
                  onChange={e => setNamePattern(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="export-dialog__preview">{previewName}</div>
              <div className="export-dialog__tokens">
                {['{name}', '{stem}', '{bpm}', '{beats}', '{in}', '{out}', '{n}'].map(t => (
                  <button
                    key={t}
                    className="export-dialog__token"
                    onClick={() => setNamePattern(p => p + t)}
                  >{t}</button>
                ))}
              </div>
            </div>
          )}

          {/* Options */}
          {status === 'idle' && (
            <div className="export-dialog__options">
              {addToEnd && (
                <label className="export-dialog__check">
                  <input type="checkbox" checked={fadeAtLoop} onChange={e => setFadeAtLoop(e.target.checked)} />
                  Fade at loop
                </label>
              )}
              <div className="export-dialog__norm-row">
                <label className="export-dialog__check">
                  <input type="checkbox" checked={normalizeBpm} onChange={e => setNormalizeBpm(e.target.checked)} />
                  Normalize to
                </label>
                {normalizeBpm && (
                  <input
                    className="export-dialog__norm-bpm"
                    type="number" min={1} max={999} step={1}
                    value={normBpmTarget}
                    onChange={e => setNormBpmTarget(Number(e.target.value))}
                  />
                )}
                {normalizeBpm && <span className="export-dialog__norm-label">BPM</span>}
              </div>
              <div className="export-dialog__audio">
                <label className="export-dialog__check">
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    onChange={e => setIncludeAudio(e.target.checked)}
                  />
                  Include Audio
                </label>
                {includeAudio && (
                  <label
                    className="export-dialog__check export-dialog__audio-sub"
                    title="When on, audio pitches up/down with the video speed (asetrate). When off, atempo preserves pitch."
                  >
                    <input
                      type="checkbox"
                      checked={pitchAudio}
                      onChange={e => setPitchAudio(e.target.checked)}
                    />
                    Pitch with speed
                  </label>
                )}
              </div>
              <div className="export-dialog__interp">
                <label className="export-dialog__check">
                  <input
                    type="checkbox"
                    checked={interpolateFrames}
                    onChange={e => setInterpolateFrames(e.target.checked)}
                  />
                  Interpolate Frames
                </label>
                {interpolateFrames && (
                  <div className="export-dialog__interp-panel" aria-label="Interpolation Options">
                    <label className="export-dialog__interp-field">
                      <span className="export-dialog__interp-label">Method</span>
                      <select
                        className="export-dialog__interp-method"
                        aria-label="Interpolation Method"
                        value={interpMethod}
                        onChange={e => setInterpMethod(e.target.value as InterpMethod)}
                      >
                        <option value="minterpolate">minterpolate</option>
                        <option value="rife">RIFE</option>
                      </select>
                    </label>
                    <label className="export-dialog__interp-field">
                      <span className="export-dialog__interp-label">FPS</span>
                      <input
                        className="export-dialog__norm-bpm"
                        aria-label="Target FPS"
                        type="number" min={1} max={240} step={1}
                        value={interpFps}
                        onChange={e => setInterpFps(Number(e.target.value))}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Processing status */}
          {(status === 'processing' || logLines.length > 0) && (
            <div className="export-dialog__job-info">
              {totalJobs > 1 ? `${currentJobLabel} (${currentJobIdx + 1}/${totalJobs})` : currentJobLabel}
            </div>
          )}

          {/* Output log — persists after processing so user can review */}
          {logLines.length > 0 && (
            <div className="export-dialog__log" ref={logRef} aria-label="Export Log">
              {logLines.map((line, i) => (
                <div key={i} className="export-dialog__log-line">{line}</div>
              ))}
            </div>
          )}

        </div>

        <div className="export-dialog__footer">
          {status === 'error' && (
            <span className="export-dialog__error" title={error ?? ''}>{error}</span>
          )}

          {status === 'processing' ? (
            <div className="export-dialog__progress-wrap">
              <div className="export-dialog__progress-text">
                <span className="export-dialog__progress-pct">
                  {Math.round(((currentJobIdx + progress) / Math.max(totalJobs, 1)) * 100)}%
                </span>
                {currentMessage && (
                  <span className="export-dialog__progress-msg" title={currentMessage}>
                    {currentMessage}
                  </span>
                )}
                {savedFolder && (
                  <button
                    className="export-dialog__open-folder"
                    onClick={() => revealInFolder(savedFolder)}
                    title={savedFolder}
                  >
                    Show Folder
                  </button>
                )}
              </div>
              <div className="export-dialog__progress">
                <div
                  className="export-dialog__progress-fill"
                  style={{ width: `${((currentJobIdx + progress) / Math.max(totalJobs, 1)) * 100}%` }}
                />
              </div>
            </div>
          ) : status === 'done' && outputPaths.length > 0 ? (
            <div className="export-dialog__results">
              {outputPaths.length === 1 ? (
                <div className="export-dialog__results-row">
                  <button className="export-dialog__save" onClick={() => handleSaveOne(0)} disabled={saving || savedCount > 0}>
                    {saving ? '…' : savedCount > 0 ? '✓ Saved' : destFolder ? 'Save' : 'Save As…'}
                  </button>
                  {savedFolder && (
                    <button
                      className="export-dialog__open-folder"
                      onClick={() => revealInFolder(savedFolder)}
                      title={savedFolder}
                    >
                      Open Folder
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="export-dialog__results-row">
                    <button className="export-dialog__save" onClick={handleSaveAll} disabled={saving || savedCount >= outputPaths.length}>
                      {saving ? '…' : savedCount >= outputPaths.length ? `✓ All Saved` : `Save All (${outputPaths.length})`}
                    </button>
                    {savedFolder && (
                      <button
                        className="export-dialog__open-folder"
                        onClick={() => revealInFolder(savedFolder)}
                        title={savedFolder}
                      >
                        Open Folder
                      </button>
                    )}
                  </div>
                  <div className="export-dialog__result-list">
                    {outputPaths.map((_, i) => (
                      <button
                        key={i}
                        className="export-dialog__result-item"
                        onClick={() => handleSaveOne(i)}
                        disabled={saving}
                      >
                        {jobs[i]?.label ?? `Clip ${i + 1}`}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              className="export-dialog__process"
              onClick={process}
              disabled={!canProcess || (mode === 'selected' && selectedRegionIds.size === 0)}
            >
              {mode === 'all'
                ? `Process ${regions.length}`
                : mode === 'selected'
                  ? `Process ${selectedRegionIds.size}`
                  : 'Process'}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
