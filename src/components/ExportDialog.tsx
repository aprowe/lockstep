import { useEffect, useRef, useState } from 'react'
import type { WarpData } from '../types'
import { startWarp, listenWarpProgress, saveOutput } from '../api/warp'
import type { UnlistenFn } from '@tauri-apps/api/event'
import './ExportDialog.css'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  warpData: WarpData | null
  videoPath: string
  originalName: string
  loopBeats: number | null
  addToEnd: boolean
  trimToLoop: boolean
  clipIn?: number | null
  clipOut?: number | null
}

export default function ExportDialog({
  open, onClose, warpData, videoPath, originalName,
  loopBeats, addToEnd, trimToLoop, clipIn, clipOut,
}: ExportDialogProps) {
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

  useEffect(() => {
    if (open) { setStatus('idle'); setProgress(0); setError(null); setOutputPath(null) }
  }, [open])

  const bpm = warpData?.bpm ?? 120
  const canProcess = !!warpData && (warpData.origAnchors.length ?? 0) >= 1

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
        clip_in: clipIn ?? null,
        clip_out: clipOut ?? null,
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

  const handleClose = () => {
    if (status === 'processing') return
    onClose()
  }

  if (!open) return null

  return (
    <div className="export-overlay" onClick={handleClose}>
      <div className="export-dialog" onClick={e => e.stopPropagation()}>
        <div className="export-dialog__header">
          <span className="export-dialog__title">Export</span>
          <button className="export-dialog__close" onClick={handleClose} disabled={status === 'processing'}>✕</button>
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
            <div className="export-dialog__progress">
              <div className="export-dialog__progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          ) : status === 'done' && outputPath ? (
            <button className="export-dialog__save" onClick={handleSave} disabled={saving}>
              {saving ? '...' : 'Save MP4'}
            </button>
          ) : (
            <button className="export-dialog__process" onClick={process} disabled={!canProcess}>
              Process
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
