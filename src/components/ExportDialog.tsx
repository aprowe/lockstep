import { useEffect, useMemo, useRef, useState } from 'react'
import type { WarpData, Region } from '../types'
import { startWarp, listenWarpProgress, pickExportFolder, saveToFolder, revealInFolder } from '../api/warp'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { setLastExportFolder } from '../store/slices/uiSlice'
import { addJob as addJobAction, updateJob, removeJob } from '../store/slices/jobsSlice'
import { cancelJobThunk } from '../store/thunks/jobsThunks'
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
  /** Open directly on the Log tab instead of Queue. */
  openOnLogTab?: boolean
  /** Pre-select this job id when opening on the Log tab. */
  initialLogJobId?: string | null
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
  selectedClipIds, openOnLogTab, initialLogJobId,
}: ExportDialogProps) {
  const [activeTab, setActiveTab] = useState<'export' | 'log'>('export')
  const [selectedLogJobId, setSelectedLogJobId] = useState<string | null>(null)

  const [fadeAtLoop, setFadeAtLoop] = useState(false)
  const [interpolateFrames, setInterpolateFrames] = useState(false)
  const [interpMethod, setInterpMethod] = useState<InterpMethod>('rife')
  const [interpFps, setInterpFps] = useState(() => Math.round(videoFps ?? 60))
  const [normalizeBpm, setNormalizeBpm] = useState(false)
  const [normBpmTarget, setNormBpmTarget] = useState(120)
  // Audio export mode: 'tempo' keeps pitch (default), 'pitch' re-pitches with speed, 'none' omits audio.
  const [includeAudio, setIncludeAudio] = useState(true)
  const [pitchAudio, setPitchAudio] = useState(false)
  const audioMode: AudioMode = !includeAudio ? 'none' : pitchAudio ? 'pitch' : 'tempo'
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [currentJobLabel, setCurrentJobLabel] = useState('')
  const [currentJobIdx, setCurrentJobIdx] = useState(0)
  const [totalJobs, setTotalJobs] = useState(0)
  const [currentMessage, setCurrentMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
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
  const allJobs = useAppSelector(s => s.jobs.jobs)
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

  // Auto-select the most recent job when the Log tab is shown and no job is selected
  const selectedLogJob = allJobs.find(j => j.id === selectedLogJobId) ?? allJobs[0] ?? null

  useEffect(() => {
    if (!open) return
    // Always honour the caller's tab preference — right-click Export must land
    // on the Export tab even if a job is still running in the background.
    setActiveTab(openOnLogTab ? 'log' : 'export')
    if (openOnLogTab && initialLogJobId) setSelectedLogJobId(initialLogJobId)

    // Do not reset the rest of the state while a background export is running —
    // the user may be reopening the dialog to see its progress.
    if (status === 'processing') return
    setStatus('idle')
    setProgress(0)
    setError(null)
    setCurrentJobIdx(0)
    setTotalJobs(0)
    setCurrentMessage('')
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
  }, [open, regions, videoFps, selectedClipIds]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { unlistenRef.current?.() }, [])

  // Auto-scroll the log to the latest line as it grows.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [selectedLogJob?.logs.length])

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
    const clipNumber = job.regionIndex >= 0 ? job.regionIndex + 1 : index + 1
    const name = applyPattern(namePattern, {
      name: job.label,
      stem: baseName,
      bpm: job.bpm,
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
    setError(null)
    setCurrentMessage('')
    cancelRef.current = false

    // Switch to Log tab immediately so the user can see progress
    setActiveTab('log')

    let firstError: string | null = null
    // Once a job errors we lock the log view on it — subsequent jobs starting
    // should not override the selection so the operator can see the failure.
    let erroredJobId: string | null = null

    for (let i = 0; i < jobs.length; i++) {
      if (cancelRef.current) break
      const job = jobs[i]
      setCurrentJobIdx(i)
      setCurrentJobLabel(job.label)
      setProgress(0)
      setCurrentMessage('')

      try {
        const jobId = await startWarp(buildWarpRequest({
          videoPath,
          warpData,
          job,
          loopBeats,
          trimToLoop,
          fadeAtLoop,
          interpolateFrames,
          interpFps,
          interpMethod,
          sceneCuts,
          audioMode,
        }))
        reduxDispatch(addJobAction({ id: jobId, kind: 'warp', label: job.label }))
        // Auto-select each new job unless a previous one errored (keep that visible).
        if (!erroredJobId) setSelectedLogJobId(jobId)

        const outputPath = await new Promise<string>((resolve, reject) => {
          listenWarpProgress(payload => {
            if (payload.job_id !== jobId) return
            setProgress(payload.percent ?? 0)
            const msg = payload.message
            if (msg) {
              setCurrentMessage(msg)
              reduxDispatch(updateJob({ id: jobId, progress: payload.percent, message: msg }))
            }
            if (payload.status === 'done' && payload.output_path) {
              unlistenRef.current?.()
              reduxDispatch(updateJob({ id: jobId, status: 'done', progress: 1 }))
              resolve(payload.output_path)
            }
            if (payload.status === 'error') {
              unlistenRef.current?.()
              const errMsg = payload.error ?? 'Unknown error'
              reduxDispatch(updateJob({ id: jobId, status: 'error', error: errMsg, message: errMsg }))
              erroredJobId = jobId
              setSelectedLogJobId(jobId)
              reject(new Error(errMsg))
            }
          }).then(ul => { unlistenRef.current = ul })
        })

        if (destFolder) {
          try {
            await saveToFolder({ source_path: outputPath, dest_folder: destFolder, file_name: getFileName(job, i) })
            reduxDispatch(updateJob({ id: jobId, outputFolder: destFolder }))
          } catch (e: any) {
            const msg = `${job.label} (save): ${e.message ?? String(e)}`
            if (!firstError) firstError = msg
          }
        }
      } catch (e: any) {
        const msg = `${job.label}: ${e.message ?? String(e)}`
        if (!firstError) firstError = msg
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

  const handlePickFolder = async () => {
    try {
      const folder = await pickExportFolder()
      reduxDispatch(setLastExportFolder(folder))
    } catch {
      // cancelled
    }
  }

  // Close hides the dialog but leaves any in-flight processing running in the background.
  const handleClose = () => {
    onClose()
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
  // !open; this preserves local state (listener refs, cancelRef).
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
          <div className="export-dialog__tabs">
            <button
              type="button"
              className={`export-dialog__tab${activeTab === 'export' ? ' export-dialog__tab--active' : ''}`}
              onClick={() => {
                setActiveTab('export')
                if (status === 'done' || status === 'error') setStatus('idle')
              }}
            >
              Export
            </button>
            <button
              type="button"
              className={`export-dialog__tab${activeTab === 'log' ? ' export-dialog__tab--active' : ''}`}
              onClick={() => setActiveTab('log')}
            >
              Log
            </button>
          </div>
          <div className="export-dialog__header-actions">
            <button className="export-dialog__close" onClick={handleClose} title="Close">
              ✕
            </button>
          </div>
        </div>

        {activeTab === 'export' && (
          <div className="export-dialog__body">

            {/* Clip mode selector */}
            {hasRegions && (
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
                  aria-label="All Clips"
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
            {mode === 'selected' && (
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
            {(
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
            {(
              <div className="export-dialog__options">
                {addToEnd && (
                  <label className="export-dialog__check">
                    <input type="checkbox" checked={fadeAtLoop} onChange={e => setFadeAtLoop(e.target.checked)} />
                    Fade at loop
                  </label>
                )}
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

          </div>
        )}

        {activeTab === 'log' && (
          <div className="export-dialog__body">
            {allJobs.length === 0 ? (
              <div className="vj-empty-panel">No tasks yet</div>
            ) : (
              <>
                <select
                  className="export-dialog__job-select"
                  value={selectedLogJob?.id ?? ''}
                  onChange={e => setSelectedLogJobId(e.target.value)}
                  aria-label="Select task"
                >
                  {allJobs.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.label} — {j.status === 'running' ? `${Math.round(j.progress * 100)}%` : j.status}
                    </option>
                  ))}
                </select>

                {selectedLogJob && (
                  <div className="export-dialog__log-detail">
                    <div className="export-dialog__log-detail-head">
                      <span className="export-dialog__log-detail-label">{selectedLogJob.label}</span>
                      <span className={`export-dialog__log-detail-status export-dialog__log-detail-status--${selectedLogJob.status}`}>
                        {selectedLogJob.status === 'running'
                          ? `${Math.round(selectedLogJob.progress * 100)}%`
                          : selectedLogJob.status}
                      </span>
                    </div>

                    {selectedLogJob.status === 'running' && (
                      <div className="export-dialog__progress">
                        <div
                          className="export-dialog__progress-fill"
                          style={{ width: `${Math.max(2, Math.round(selectedLogJob.progress * 100))}%` }}
                        />
                      </div>
                    )}

                    {selectedLogJob.logs.length > 0 && (
                      <div className="export-dialog__log" ref={logRef} aria-label="Export Log">
                        {selectedLogJob.logs.map((line, i) => (
                          <div key={i} className="export-dialog__log-line">{line}</div>
                        ))}
                      </div>
                    )}

                    {selectedLogJob.error && (
                      <div className="export-dialog__error">{selectedLogJob.error}</div>
                    )}

                    <div className="export-dialog__log-actions">
                      {selectedLogJob.outputFolder ? (
                        <>
                          <span className="export-dialog__saved-label">✓ Saved</span>
                          <button
                            type="button"
                            className="export-dialog__open-folder"
                            onClick={() => revealInFolder(selectedLogJob.outputFolder!)}
                            title={selectedLogJob.outputFolder}
                          >
                            Show in Folder
                          </button>
                        </>
                      ) : selectedLogJob.status === 'running' && destFolder ? (
                        <button
                          type="button"
                          className="export-dialog__open-folder"
                          onClick={() => revealInFolder(destFolder)}
                          title={destFolder}
                        >
                          Show Folder
                        </button>
                      ) : selectedLogJob.status === 'done' && (
                        <span className="export-dialog__saved-label export-dialog__saved-label--pending">Not saved</span>
                      )}
                      {selectedLogJob.status === 'running' ? (
                        <button
                          type="button"
                          className="export-dialog__btn-secondary"
                          onClick={() => reduxDispatch(cancelJobThunk(selectedLogJob.id))}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="export-dialog__btn-secondary"
                          onClick={() => reduxDispatch(removeJob(selectedLogJob.id))}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'export' && (
          <div className="export-dialog__footer">
            <button
              className="export-dialog__process"
              onClick={process}
              disabled={!canProcess || status === 'processing' || (mode === 'selected' && selectedRegionIds.size === 0)}
            >
              {mode === 'all'
                ? `Process ${regions.length}`
                : mode === 'selected'
                  ? `Process ${selectedRegionIds.size}`
                  : 'Process'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
