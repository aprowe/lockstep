import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { WarpViewHandle } from './WarpView'
import type { WarpData } from '../types'
import { startWarp, listenWarpProgress, saveOutput } from '../api/warp'
import { startDiagnostic, listenDiagnosticProgress } from '../api/diagnostic'
import type { UnlistenFn } from '@tauri-apps/api/event'
import './WarpPanel.css'

function StretchInput({
  label, value, onChange, min, max, step = 0.05,
}: {
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step?: number
}) {
  const [raw, setRaw] = useState(value.toFixed(2))
  useEffect(() => setRaw(value.toFixed(2)), [value])
  const commit = () => {
    const n = parseFloat(raw)
    if (!isNaN(n) && n >= min && n <= max) onChange(n)
    else setRaw(value.toFixed(2))
  }
  return (
    <div className="warp-panel__row">
      <span className="warp-panel__label">{label}</span>
      <input
        className="warp-panel__num-input"
        type="number" min={min} max={max} step={step} value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
      />
      <span className="warp-panel__unit">×</span>
    </div>
  )
}

interface WarpPanelProps {
  warpRef: RefObject<WarpViewHandle | null>
  warpData: WarpData | null
  videoPath: string
  originalName: string
  trimToLoop: boolean
  onTrimToLoopChange: (v: boolean) => void
  loopBeats: number | null
  onLoopBeatsChange: (v: number | null) => void
  addToEnd: boolean
  onAddToEndChange: (v: boolean) => void
  onNew: () => void
  clipIn?: number | null
  clipOut?: number | null
}

export default function WarpPanel({
  warpRef, warpData, videoPath, originalName,
  trimToLoop, onTrimToLoopChange,
  loopBeats, onLoopBeatsChange,
  addToEnd, onAddToEndChange,
  onNew,
  clipIn, clipOut,
}: WarpPanelProps) {
  const [bpmInput, setBpmInput] = useState(String(warpData?.bpm ?? 120))
  const [minStretch, setMinStretchLocal] = useState(warpData?.minStretch ?? 0.5)
  const [maxStretch, setMaxStretchLocal] = useState(warpData?.maxStretch ?? 2.0)

  useEffect(() => { if (warpData?.bpm != null) setBpmInput(String(warpData.bpm)) }, [warpData?.bpm])
  useEffect(() => { if (warpData?.minStretch != null) setMinStretchLocal(warpData.minStretch) }, [warpData?.minStretch])
  useEffect(() => { if (warpData?.maxStretch != null) setMaxStretchLocal(warpData.maxStretch) }, [warpData?.maxStretch])

  const [detecting, setDetecting] = useState(false)
  const tapTimesRef = useRef<number[]>([])
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [fadeAtLoop, setFadeAtLoop] = useState(false)
  const [normalizeBpm, setNormalizeBpm] = useState(false)
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [suggestedName, setSuggestedName] = useState('warped.mp4')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const unlistenRef = useRef<UnlistenFn | null>(null)

  // ── Diagnostic / Overlay state ─────────────────────────────────────────────
  const [diagStatus, setDiagStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [diagProgress, setDiagProgress] = useState(0)
  const [diagOutputPath, setDiagOutputPath] = useState<string | null>(null)
  const [diagMode, setDiagMode] = useState<'diagnostic' | 'overlay'>('diagnostic')
  const [diagError, setDiagError] = useState<string | null>(null)
  const unlistenDiagRef = useRef<UnlistenFn | null>(null)

  useEffect(() => () => { unlistenRef.current?.(); unlistenDiagRef.current?.() }, [])

  const commitBpm = () => {
    const n = parseFloat(bpmInput)
    if (n > 0 && n <= 999) warpRef.current?.setBpm(n)
    else setBpmInput(String(warpData?.bpm ?? 120))
  }

  const handleTap = () => {
    const now = performance.now()
    const taps = tapTimesRef.current
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) tapTimesRef.current = []
    tapTimesRef.current.push(now)
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current)
    tapTimeoutRef.current = setTimeout(() => { tapTimesRef.current = [] }, 2000)
    if (tapTimesRef.current.length >= 2) {
      const intervals = tapTimesRef.current.slice(1).map((t, i) => t - tapTimesRef.current[i])
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const bpmValue = Math.round(60000 / avgInterval)
      if (bpmValue > 0 && bpmValue <= 999) {
        setBpmInput(String(bpmValue))
        warpRef.current?.setBpm(bpmValue)
      }
    }
  }

  const handleDetect = async () => {
    setDetecting(true)
    await warpRef.current?.detectBpm()
    setDetecting(false)
  }

  const handleMinStretch = (v: number) => {
    const clamped = Math.min(v, maxStretch - 0.05)
    setMinStretchLocal(clamped)
    warpRef.current?.setMinStretch(clamped)
  }

  const handleMaxStretch = (v: number) => {
    const clamped = Math.max(v, minStretch + 0.05)
    setMaxStretchLocal(clamped)
    warpRef.current?.setMaxStretch(clamped)
  }

  const bpm = warpData?.bpm ?? 120
  const anchorCount = warpData?.origAnchors.length ?? 0

  const process = async () => {
    if (!warpData || !videoPath) return
    unlistenRef.current?.()
    setStatus('processing')
    setProgress(0)
    setError(null)
    setOutputPath(null)

    try {
      // Sort orig and beat anchors by orig time before sending
      const offset = clipIn ?? 0
      const pairs = [...warpData.origAnchors]
        .sort((a, b) => a.time - b.time)
        .map(oa => ({
          orig: oa.time + offset,  // convert clip-local time to absolute video time
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
          const beats = loopBeats ?? (payload.percent ? Math.round((warpData.beatZeroTime ?? 0) * bpm / 60) : null)
          setSuggestedName(beats ? `${baseName}_${beats}beats_${Math.round(bpm)}bpm.mp4` : `${baseName}_warped.mp4`)
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

  const canProcess = !!warpData && anchorCount >= 1

  const handleDiag = async (mode: 'diagnostic' | 'overlay') => {
    if (!videoPath || !warpData) return
    unlistenDiagRef.current?.()
    setDiagMode(mode)
    setDiagStatus('running')
    setDiagProgress(0)
    setDiagError(null)
    setDiagOutputPath(null)

    try {
      const jobId = await startDiagnostic({
        path: videoPath,
        bpm: warpData.bpm,
        beat_zero_time: warpData.beatZeroTime ?? 0,
        mode,
      })
      unlistenDiagRef.current = await listenDiagnosticProgress(p => {
        if (p.job_id !== jobId) return
        setDiagProgress(p.percent ?? 0)
        if (p.status === 'done' && p.output_path) {
          setDiagStatus('done')
          setDiagOutputPath(p.output_path)
          unlistenDiagRef.current?.()
        }
        if (p.status === 'error') {
          setDiagStatus('error')
          setDiagError(p.error ?? 'Unknown error')
          unlistenDiagRef.current?.()
        }
      })
    } catch (e: any) {
      setDiagStatus('error')
      setDiagError(e.message ?? String(e))
    }
  }

  const handleDiagSave = async () => {
    if (!diagOutputPath) return
    setSaving(true)
    try {
      await saveOutput({ source_path: diagOutputPath, suggested_name: `${diagMode}_${Math.round(warpData?.bpm ?? 120)}bpm.mp4` })
    } catch (e: any) {
      if (!String(e).includes('cancelled')) setDiagError(e.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="warp-panel">

      {/* ── Col 1: Tempo ── */}
      <div className="warp-panel__col">
        <div className="warp-panel__col-header">Tempo</div>
        <div className="warp-panel__row">
          <span className="warp-panel__label">BPM</span>
          <input
            className="warp-panel__bpm-input"
            type="number" min={1} max={999} value={bpmInput}
            onChange={e => setBpmInput(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={e => e.key === 'Enter' && commitBpm()}
          />
          <button className="warp-panel__action" onClick={handleDetect}
            disabled={detecting || anchorCount < 2} title="Estimate BPM from anchor spacing">
            {detecting ? '…' : '⟳'}
          </button>
          <button className="warp-panel__action" onClick={handleTap} title="Tap tempo">
            Tap
          </button>
        </div>
        <StretchInput label="Min" value={minStretch} min={0.1} max={maxStretch} onChange={handleMinStretch} />
        <StretchInput label="Max" value={maxStretch} min={minStretch} max={8} onChange={handleMaxStretch} />
        <div className="warp-panel__row warp-panel__row--actions">
          <button className="warp-panel__action" onClick={() => warpRef.current?.clearAnchors()} title="Remove all markers">Clear</button>
          <button className="warp-panel__action" onClick={() => warpRef.current?.resetAllLinks()} disabled={anchorCount === 0} title="Reset beat positions">Reset</button>
          <button className="warp-panel__action" onClick={() => warpRef.current?.snapToBeat()} disabled={anchorCount === 0} title="Snap all beat markers to nearest beat (resolves conflicts)">Snap</button>
          <button className="warp-panel__action" onClick={() => warpRef.current?.exportMarkers()} disabled={anchorCount === 0} title="Download markers as JSON">Export</button>
          <button className="warp-panel__action" onClick={() => warpRef.current?.triggerImport()} title="Load markers from JSON">Import</button>
        </div>
      </div>

      {/* ── Col 2: Loop ── */}
      <div className="warp-panel__col">
        <div className="warp-panel__col-header">Loop</div>
        <div className="warp-panel__row">
          <span className="warp-panel__label">Beats</span>
          <input
            className="warp-panel__num-input" type="number" min={1} placeholder="—"
            value={loopBeats ?? ''}
            onChange={e => {
              const v = parseInt(e.target.value)
              onLoopBeatsChange(isNaN(v) || v <= 0 ? null : v)
            }}
            disabled={status === 'processing'}
          />
        </div>
        <label className="warp-panel__check">
          <input type="checkbox" checked={addToEnd} onChange={e => onAddToEndChange(e.target.checked)} />
          Pre-beat
        </label>
        {addToEnd && (
          <label className="warp-panel__check warp-panel__check--sub">
            <input type="checkbox" checked={fadeAtLoop} onChange={e => setFadeAtLoop(e.target.checked)} />
            Fade at loop
          </label>
        )}
        <label className="warp-panel__check">
          <input type="checkbox" checked={trimToLoop} onChange={e => onTrimToLoopChange(e.target.checked)} />
          Trim to beat
        </label>
      </div>

      {/* ── Col 3: Output ── */}
      <div className="warp-panel__col warp-panel__col--output">
        <div className="warp-panel__col-header">Output</div>
        <label className="warp-panel__check">
          <input type="checkbox" checked={normalizeBpm} onChange={e => setNormalizeBpm(e.target.checked)} />
          Normalize BPM
        </label>

        {status === 'processing' ? (
          <div className="warp-panel__progress">
            <div className="warp-panel__progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        ) : (
          <button className="warp-panel__btn" onClick={process} disabled={!canProcess}>
            Process
          </button>
        )}

        {status === 'error' && (
          <span className="warp-panel__error" title={error ?? ''}>{error}</span>
        )}

        {status === 'done' && outputPath && (
          <button className="warp-panel__download" onClick={handleSave} disabled={saving}>
            {saving ? '…' : '↓ Save MP4'}
          </button>
        )}

        <div className="warp-panel__file-row">
          <span className="warp-panel__filename" title={originalName}>{originalName}</span>
          <button className="warp-panel__new" onClick={onNew} title="Open a different video">✕</button>
        </div>
      </div>

      {/* ── Col 4: Debug ── */}
      <div className="warp-panel__col">
        <div className="warp-panel__col-header">Debug</div>

        {diagStatus === 'running' ? (
          <div className="warp-panel__progress">
            <div className="warp-panel__progress-fill" style={{ width: `${diagProgress * 100}%` }} />
          </div>
        ) : (
          <div className="warp-panel__row warp-panel__row--actions">
            <button
              className="warp-panel__action"
              onClick={() => handleDiag('diagnostic')}
              disabled={!canProcess}
              title="Generate test video: metronome visuals with identical timing structure as source"
            >Test</button>
            <button
              className="warp-panel__action"
              onClick={() => handleDiag('overlay')}
              disabled={!canProcess}
              title="Overlay metronome HUD on top of the original video"
            >Overlay</button>
          </div>
        )}

        {diagStatus === 'error' && (
          <span className="warp-panel__error" title={diagError ?? ''}>{diagError}</span>
        )}

        {diagStatus === 'done' && diagOutputPath && (
          <button className="warp-panel__download" onClick={handleDiagSave} disabled={saving}>
            {saving ? '…' : `↓ Save ${diagMode}`}
          </button>
        )}

        <p className="warp-panel__debug-hint">
          {diagStatus === 'idle' && 'Test: replace pixels, copy timing. Overlay: HUD on source.'}
          {diagStatus === 'running' && `Generating ${diagMode}…`}
          {diagStatus === 'done' && 'Ready to save.'}
        </p>
      </div>

    </div>
  )
}
