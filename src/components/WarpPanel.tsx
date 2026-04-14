import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { WarpViewHandle } from './WarpView'
import type { WarpData } from '../types'
import { startWarp, listenWarpProgress, saveOutput } from '../api/warp'
import type { UnlistenFn } from '@tauri-apps/api/event'
import './WarpPanel.css'

interface WarpPanelProps {
  warpRef: RefObject<WarpViewHandle | null>
  warpData: WarpData | null
  videoPath: string
  originalName: string
  onNew: () => void
  loopBeats: number | null
  onLoopBeatsChange: (v: number | null) => void
  addToEnd: boolean
  onAddToEndChange: (v: boolean) => void
  trimToLoop: boolean
  onTrimToLoopChange: (v: boolean) => void
  exportOpen: boolean
  onExportOpenChange: (v: boolean) => void
}

export default function WarpPanel({
  warpRef, warpData, videoPath, originalName, onNew,
  loopBeats, onLoopBeatsChange,
  addToEnd, onAddToEndChange,
  trimToLoop, onTrimToLoopChange,
  exportOpen, onExportOpenChange,
}: WarpPanelProps) {

  // ── Export dialog state ────────────────────────────────────────────────────
  const [fadeAtLoop, setFadeAtLoop] = useState(false)
  const [normalizeBpm, setNormalizeBpm] = useState(false)
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [suggestedName, setSuggestedName] = useState('warped.mp4')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const unlistenRef = useRef<UnlistenFn | null>(null)

  useEffect(() => () => { unlistenRef.current?.() }, [])

  const bpm = warpData?.bpm ?? 120
  const anchorCount = warpData?.origAnchors.length ?? 0
  const canProcess = !!warpData && anchorCount >= 1

  const process = async () => {
    if (!warpData || !videoPath) return
    unlistenRef.current?.()
    setStatus('processing')
    setProgress(0)
    setError(null)
    setOutputPath(null)

    try {
      const pairs = [...warpData.origAnchors]
        .sort((a, b) => a.time - b.time)
        .map(oa => ({
          orig: oa.time,
          beat: warpData.beatAnchors.find(ba => ba.id === oa.id)?.time ?? oa.time,
        }))

      const jobId = await startWarp({
        path: videoPath,
        orig_times: pairs.map(p => p.orig),
        beat_times: pairs.map(p => p.beat),
        bpm,
        beat_zero_time: warpData.beatZeroTime ?? 0,
        add_to_end: addToEnd,
        fade_at_loop: fadeAtLoop && addToEnd,
        trim_to_loop: trimToLoop,
        loop_beats: loopBeats ?? null,
        normalize_bpm: normalizeBpm,
        clip_in: null,
        clip_out: null,
      })

      unlistenRef.current = await listenWarpProgress(payload => {
        if (payload.job_id !== jobId) return
        setProgress(payload.percent ?? 0)
        if (payload.status === 'done' && payload.output_path) {
          setStatus('done')
          setOutputPath(payload.output_path)
          const baseName = originalName.replace(/\.[^.]+$/, '')
          setSuggestedName(loopBeats
            ? `${baseName}_${loopBeats}beats_${Math.round(bpm)}bpm.mp4`
            : `${baseName}_warped.mp4`)
          unlistenRef.current?.()
        }
        if (payload.status === 'error') {
          setStatus('error')
          setError(payload.error ?? 'Unknown error')
          unlistenRef.current?.()
        }
      })
    } catch (e: any) {
      setStatus('error')
      setError(e.message ?? String(e))
    }
  }

  const handleSave = async () => {
    if (!outputPath) return
    setSaving(true)
    try {
      await saveOutput({ source_path: outputPath, suggested_name: suggestedName })
    } catch (e: any) {
      if (!String(e).includes('cancelled')) setError(e.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  // Reset export state when dialog opens
  useEffect(() => {
    if (exportOpen) { setStatus('idle'); setProgress(0); setError(null); setOutputPath(null) }
  }, [exportOpen])

  const handleCloseExport = () => {
    if (status === 'processing') return
    onExportOpenChange(false)
  }

  return (
    <>
      <div className="warp-panel">

        {/* ── File row ── */}
        <div className="warp-panel__file-row">
          <span className="warp-panel__filename" title={originalName}>{originalName}</span>
          <button className="warp-panel__new" onClick={onNew} title="Close video">✕</button>
        </div>

        {/* ── Warp options ── */}
        <div className="warp-panel__section">
          <div className="warp-panel__row">
            <span className="warp-panel__label">Loop beats</span>
            <input
              className="warp-panel__num-input"
              type="number" min={1} placeholder="—"
              value={loopBeats ?? ''}
              onChange={e => { const v = parseInt(e.target.value); onLoopBeatsChange(isNaN(v) || v <= 0 ? null : v) }}
            />
          </div>

          <label className="warp-panel__check">
            <input type="checkbox" checked={trimToLoop} onChange={e => onTrimToLoopChange(e.target.checked)} />
            Trim to beat
          </label>

          <label className="warp-panel__check">
            <input type="checkbox" checked={addToEnd} onChange={e => onAddToEndChange(e.target.checked)} />
            Pre-beat intro
          </label>
        </div>

      </div>

      {/* ── Export dialog ── */}
      {exportOpen && (
        <div className="export-overlay" onClick={handleCloseExport}>
          <div className="export-dialog" onClick={e => e.stopPropagation()}>
            <div className="export-dialog__header">
              <span className="export-dialog__title">Export Options</span>
              <button className="export-dialog__close" onClick={handleCloseExport} disabled={status === 'processing'}>✕</button>
            </div>

            <div className="export-dialog__body">
              {addToEnd && (
                <label className="export-dialog__check">
                  <input type="checkbox" checked={fadeAtLoop} onChange={e => setFadeAtLoop(e.target.checked)} disabled={status === 'processing'} />
                  Fade at loop
                </label>
              )}

              <label className="export-dialog__check">
                <input type="checkbox" checked={normalizeBpm} onChange={e => setNormalizeBpm(e.target.checked)} disabled={status === 'processing'} />
                Normalize BPM
              </label>
            </div>

            <div className="export-dialog__footer">
              {status === 'error' && (
                <span className="export-dialog__error" title={error ?? ''}>{error}</span>
              )}

              {status === 'processing' ? (
                <div className="warp-panel__progress">
                  <div className="warp-panel__progress-fill" style={{ width: `${progress * 100}%` }} />
                </div>
              ) : status === 'done' && outputPath ? (
                <button className="warp-panel__download" onClick={handleSave} disabled={saving}>
                  {saving ? '…' : '↓ Save MP4'}
                </button>
              ) : (
                <button className="warp-panel__btn" onClick={process} disabled={!canProcess}>
                  Process
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
