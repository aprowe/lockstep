import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { analyzeAnchors } from '../api/warp'
import Timeline, { newAnchorId } from './Timeline'
import WarpConnector from './WarpConnector'
import {
  buildSegments,
  computeOutputDuration,
  origBands,
  quantBands,
  snapAllToBeat,
} from '../utils/quantize'
import { clampView } from '../utils/view'
import type { Anchor, View, WarpData } from '../types'
import './WarpView.css'

interface HistoryEntry {
  origAnchors: Anchor[]
  beatAnchors: Anchor[]
  linkedBeat: number[]
  beatZeroId: number | null
}

interface WarpViewProps {
  duration?: number
  initialBpm?: number
  initialMinStretch?: number
  initialMaxStretch?: number
  addToEnd?: boolean
  initialBeatZeroAnchorTime?: number
  initialOrigAnchors?: Anchor[]
  initialBeatAnchors?: Anchor[]
  playhead?: number
  onSeek?: (time: number) => void
  onDataChange?: (data: WarpData) => void
  videoPath?: string
  trimToLoop?: boolean
  loopBeats?: number | null
}

export interface WarpViewHandle {
  addAnchor(time: number): void
  clearAnchors(): void
  resetAllLinks(): void
  setBpm(b: number): void
  setMinStretch(v: number): void
  setMaxStretch(v: number): void
  exportMarkers(): void
  triggerImport(): void
  detectBpm(): Promise<number | null>
  snapToBeat(): void
}

const WarpView = forwardRef<WarpViewHandle, WarpViewProps>(function WarpView({
  duration = 60,
  initialBpm = 120,
  initialMinStretch,
  initialMaxStretch,
  addToEnd = false,
  initialBeatZeroAnchorTime,
  initialOrigAnchors,
  initialBeatAnchors,
  playhead,
  onSeek,
  onDataChange,
  videoPath,
  trimToLoop = false,
  loopBeats,
}, ref) {
  const [origAnchors, setOrigAnchors] = useState<Anchor[]>(initialOrigAnchors ?? [])
  const [beatAnchors, setBeatAnchors] = useState<Anchor[]>(initialBeatAnchors ?? [])
  const linkedBeat = useRef<Set<number>>(new Set())

  const historyStack = useRef<HistoryEntry[]>([{
    origAnchors: initialOrigAnchors ?? [],
    beatAnchors: initialBeatAnchors ?? [],
    linkedBeat: [],
    beatZeroId: null,
  }])
  const historyIdx = useRef(0)
  const isApplyingHistory = useRef(false)
  const [view, setView] = useState<View>({ start: 0, end: duration })
  const [bpm, setBpm] = useState(initialBpm)
  const [minStretch, setMinStretch] = useState(initialMinStretch ?? 0.5)
  const [maxStretch, setMaxStretch] = useState(initialMaxStretch ?? 2.0)
  const [beatZeroId, setBeatZeroId] = useState<number | null>(() => {
    if (initialBeatZeroAnchorTime == null || !initialBeatAnchors) return null
    const match = initialBeatAnchors.find(a => Math.abs(a.time - initialBeatZeroAnchorTime) < 0.001)
    return match?.id ?? null
  })

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isApplyingHistory.current) { isApplyingHistory.current = false; return }
      const entry: HistoryEntry = {
        origAnchors: [...origAnchors],
        beatAnchors: [...beatAnchors],
        linkedBeat: [...linkedBeat.current],
        beatZeroId,
      }
      const cur = historyStack.current[historyIdx.current]
      if (cur &&
          cur.origAnchors.length === entry.origAnchors.length &&
          cur.beatAnchors.length === entry.beatAnchors.length &&
          cur.beatZeroId === entry.beatZeroId &&
          cur.origAnchors.every((a, i) => a.id === entry.origAnchors[i].id && Math.abs(a.time - entry.origAnchors[i].time) < 0.0001) &&
          cur.beatAnchors.every((a, i) => a.id === entry.beatAnchors[i].id && Math.abs(a.time - entry.beatAnchors[i].time) < 0.0001)) return
      historyStack.current = historyStack.current.slice(0, historyIdx.current + 1)
      historyStack.current.push(entry)
      if (historyStack.current.length > 100) historyStack.current.shift()
      historyIdx.current = historyStack.current.length - 1
    }, 400)
    return () => clearTimeout(timer)
  }, [origAnchors, beatAnchors, beatZeroId]) // eslint-disable-line react-hooks/exhaustive-deps

  const undo = useCallback(() => {
    if (historyIdx.current <= 0) return
    historyIdx.current--
    const entry = historyStack.current[historyIdx.current]
    isApplyingHistory.current = true
    setOrigAnchors(entry.origAnchors)
    setBeatAnchors(entry.beatAnchors)
    linkedBeat.current = new Set(entry.linkedBeat)
    setBeatZeroId(entry.beatZeroId)
  }, [])

  const redo = useCallback(() => {
    if (historyIdx.current >= historyStack.current.length - 1) return
    historyIdx.current++
    const entry = historyStack.current[historyIdx.current]
    isApplyingHistory.current = true
    setOrigAnchors(entry.origAnchors)
    setBeatAnchors(entry.beatAnchors)
    linkedBeat.current = new Set(entry.linkedBeat)
    setBeatZeroId(entry.beatZeroId)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const beat = 60 / bpm

  const sortedOrig = useMemo(
    () => [...origAnchors].sort((a, b) => a.time - b.time),
    [origAnchors],
  )
  const sortedBeat = useMemo(
    () => sortedOrig.map(oa => beatAnchors.find(ba => ba.id === oa.id)!).filter(Boolean),
    [sortedOrig, beatAnchors],
  )

  const outputDuration = useMemo(
    () => computeOutputDuration(sortedOrig, sortedBeat, duration),
    [sortedOrig, sortedBeat, duration],
  )

  const effectiveBeatZeroId = useMemo(() => {
    if (beatZeroId !== null && sortedBeat.some(a => a.id === beatZeroId)) return beatZeroId
    return sortedBeat[0]?.id ?? null
  }, [beatZeroId, sortedBeat])

  const beatOffset = useMemo(
    () => sortedBeat.find(a => a.id === effectiveBeatZeroId)?.time ?? 0,
    [sortedBeat, effectiveBeatZeroId],
  )

  const firstBeatTime = sortedBeat[0]?.time ?? 0
  const preBeatDur = beatOffset - firstBeatTime

  const loopEndAt = loopBeats && loopBeats > 0
    ? (addToEnd && preBeatDur > 0 ? firstBeatTime + loopBeats * beat : beatOffset + loopBeats * beat)
    : undefined

  const ghostRegion = addToEnd && preBeatDur > 0 && loopEndAt !== undefined
    ? { start: loopEndAt, end: loopEndAt + preBeatDur }
    : undefined

  useEffect(() => {
    const firstOrig = [...origAnchors].sort((a, b) => a.time - b.time)[0]
    const offset = firstOrig ? beatAnchors.find(b => b.id === firstOrig.id)?.time ?? 0 : 0
    setBeatAnchors(prev =>
      prev.map(ba => {
        if (linkedBeat.current.has(ba.id)) return ba
        const snapped = offset + Math.round((ba.time - offset) / beat) * beat
        return { ...ba, time: snapped }
      }),
    )
  }, [bpm]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onDataChange?.({ origAnchors, beatAnchors, bpm, minStretch, maxStretch, beatZeroTime: beatOffset, addToEnd })
  }, [origAnchors, beatAnchors, bpm, minStretch, maxStretch, beatOffset, addToEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveOutputDuration = trimToLoop && beat > 0
    ? Math.floor(outputDuration / beat) * beat
    : outputDuration

  const maxDuration = Math.max(duration, outputDuration)

  const segments = useMemo(
    () => buildSegments(sortedOrig, sortedBeat, duration, outputDuration),
    [sortedOrig, sortedBeat, duration, outputDuration],
  )

  const handleViewChange = useCallback(
    (v: View) => setView(clampView(v.start, v.end, maxDuration)),
    [maxDuration],
  )

  const handleOrigChange = (next: Anchor[]) => {
    const prevIds = new Set(origAnchors.map(a => a.id))
    const nextIds = new Set(next.map(a => a.id))
    const added = next.filter(a => !prevIds.has(a.id))
    const removedIds = [...prevIds].filter(id => !nextIds.has(id))
    const moved = next.filter(a => {
      const prev = origAnchors.find(p => p.id === a.id)
      return prev && prev.time !== a.time
    })

    for (const a of added) linkedBeat.current.add(a.id)
    for (const id of removedIds) {
      linkedBeat.current.delete(id)
      if (id === beatZeroId) setBeatZeroId(null)
    }

    setBeatAnchors(prev => {
      let updated = prev.filter(a => !removedIds.includes(a.id))
      for (const a of added) {
        updated = [...updated, { id: a.id, time: a.time }]
      }
      for (const m of moved) {
        if (linkedBeat.current.has(m.id)) {
          updated = updated.map(ba => ba.id === m.id ? { ...ba, time: m.time } : ba)
        }
      }
      return updated
    })
    setOrigAnchors(next)
  }

  // Stable refs so imperative handle methods always see current values
  const beatRef = useRef(beat)
  beatRef.current = beat
  const beatOffsetRef = useRef(beatOffset)
  beatOffsetRef.current = beatOffset

  const importRef = useRef<HTMLInputElement>(null)

  const exportMarkers = useCallback(() => {
    const beatZeroAnchorTime = beatAnchors.find(a => a.id === effectiveBeatZeroId)?.time
    const payload = {
      origAnchors, beatAnchors, bpm, minStretch, maxStretch, addToEnd,
      ...(beatZeroAnchorTime != null ? { beatZeroAnchorTime } : {}),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `markers_${Math.round(bpm)}bpm.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [origAnchors, beatAnchors, bpm, minStretch, maxStretch, addToEnd, effectiveBeatZeroId])

  const importMarkers = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target!.result as string)
        if (!Array.isArray(data.origAnchors) || !Array.isArray(data.beatAnchors)) return
        const idMap = new Map<number, number>()
        const newOrig: Anchor[] = data.origAnchors.map((a: Anchor) => {
          const id = newAnchorId()
          idMap.set(a.id, id)
          return { id, time: a.time }
        })
        const newBeat: Anchor[] = data.beatAnchors.map((a: Anchor) => ({
          id: idMap.get(a.id) ?? newAnchorId(),
          time: a.time,
        }))
        linkedBeat.current.clear()
        setOrigAnchors(newOrig)
        setBeatAnchors(newBeat)
        if (data.bpm > 0) setBpm(data.bpm)
        if (data.minStretch > 0) setMinStretch(data.minStretch)
        if (data.maxStretch > 0) setMaxStretch(data.maxStretch)
        if (data.beatZeroAnchorTime != null) {
          const match = newBeat.find(a => Math.abs(a.time - data.beatZeroAnchorTime) < 0.001)
          setBeatZeroId(match?.id ?? null)
        } else {
          setBeatZeroId(null)
        }
      } catch { /* invalid JSON */ }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBeatChange = useCallback((next: Anchor[]) => {
    for (const a of next) {
      const prev = beatAnchors.find(b => b.id === a.id)
      if (prev && prev.time !== a.time) linkedBeat.current.delete(a.id)
    }
    setBeatAnchors(next)
  }, [beatAnchors])

  const handleBeatAnchorReset = useCallback(
    (id: number) => {
      const orig = origAnchors.find(a => a.id === id)
      if (!orig) return
      linkedBeat.current.add(id)
      setBeatAnchors(prev => prev.map(a => a.id === id ? { ...a, time: orig.time } : a))
    },
    [origAnchors],
  )

  const handleSetBeatZero = useCallback(
    (id: number) => {
      setBeatZeroId(id)
      const orig = origAnchors.find(a => a.id === id)
      if (orig) {
        linkedBeat.current.add(id)
        setBeatAnchors(prev => prev.map(a => a.id === id ? { ...a, time: orig.time } : a))
      }
    },
    [origAnchors],
  )

  const getBeatAnchorBounds = useCallback(
    (id: number): { min: number; max: number } => {
      if (id === effectiveBeatZeroId) {
        const t = sortedBeat.find(a => a.id === id)?.time ?? 0
        return { min: t, max: t }
      }
      const beatIdx = sortedBeat.findIndex(a => a.id === id)
      const origIdx = sortedOrig.findIndex(a => a.id === id)
      if (beatIdx === -1 || origIdx === -1) return { min: 0, max: outputDuration }
      let min = 0, max = outputDuration
      if (origIdx > 0) {
        const origSpan = sortedOrig[origIdx].time - sortedOrig[origIdx - 1].time
        const prevBeat = sortedBeat[beatIdx - 1]?.time ?? 0
        min = Math.max(min, prevBeat + minStretch * origSpan)
        max = Math.min(max, prevBeat + maxStretch * origSpan)
      }
      if (origIdx < sortedOrig.length - 1) {
        const origSpan = sortedOrig[origIdx + 1].time - sortedOrig[origIdx].time
        const nextBeat = sortedBeat[beatIdx + 1]?.time ?? outputDuration
        min = Math.max(min, nextBeat - maxStretch * origSpan)
        max = Math.min(max, nextBeat - minStretch * origSpan)
      }
      return { min, max }
    },
    [sortedBeat, sortedOrig, minStretch, maxStretch, outputDuration, effectiveBeatZeroId],
  )

  const quantAnchors: Anchor[] = useMemo(
    () => sortedBeat.map(a => ({ id: a.id, time: a.time })),
    [sortedBeat],
  )

  useImperativeHandle(ref, () => ({
    addAnchor(time: number) {
      const clamped = Math.max(0, Math.min(duration, time))
      handleOrigChange([...origAnchors, { id: newAnchorId(), time: clamped }])
    },
    clearAnchors() {
      linkedBeat.current.clear()
      setOrigAnchors([])
      setBeatAnchors([])
    },
    resetAllLinks() {
      setOrigAnchors(prev => {
        setBeatAnchors(prev.map(a => ({ ...a })))
        prev.forEach(a => linkedBeat.current.add(a.id))
        return prev
      })
    },
    setBpm(b: number) { setBpm(b) },
    setMinStretch(v: number) { setMinStretch(v) },
    setMaxStretch(v: number) { setMaxStretch(v) },
    exportMarkers,
    triggerImport() { importRef.current?.click() },
    async detectBpm(): Promise<number | null> {
      if (origAnchors.length < 2) return null
      try {
        const data = await analyzeAnchors(origAnchors.map(a => a.time))
        if (data.bpm && data.bpm > 0) { setBpm(data.bpm); return data.bpm }
      } catch {}
      return null
    },
    snapToBeat() {
      const b = beatRef.current
      const offset = beatOffsetRef.current
      if (!b || b <= 0) return
      setBeatAnchors(prev => {
        const snapped = snapAllToBeat(prev, b, offset)
        // All anchors are now manually positioned — remove linked-beat tracking
        snapped.forEach(a => linkedBeat.current.delete(a.id))
        return snapped
      })
    },
  }), [origAnchors, duration, exportMarkers]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="warp-view">
      <Timeline
        duration={duration}
        bpm={bpm}
        anchors={origAnchors}
        onAnchorsChange={handleOrigChange}
        bands={origBands(segments)}
        label="Original video"
        view={view}
        onViewChange={handleViewChange}
        maxDuration={maxDuration}
        playhead={playhead}
        onRulerClick={onSeek}
        onAnchorClick={onSeek}
      />
      <WarpConnector
        segments={segments}
        view={view}
        origDuration={duration}
        outputDuration={outputDuration}
      />
      <Timeline
        flip
        duration={outputDuration}
        trimAt={trimToLoop ? effectiveOutputDuration : undefined}
        bpm={bpm}
        anchors={quantAnchors}
        onAnchorsChange={handleBeatChange}
        snapInterval={beat}
        snapOffset={beatOffset}
        musicalRuler
        noAdd
        noRemove
        onAnchorDblClick={handleBeatAnchorReset}
        getBounds={getBeatAnchorBounds}
        bands={quantBands(segments)}
        label="Beat assignment — drag to assign, double-click to reset, click 0 to set beat zero"
        view={view}
        onViewChange={handleViewChange}
        maxDuration={maxDuration}
        anchorZeroId={effectiveBeatZeroId ?? undefined}
        onAnchorSetZero={handleSetBeatZero}
        loopStartAt={addToEnd && preBeatDur > 0 ? beatOffset : undefined}
        loopPreStart={addToEnd && preBeatDur > 0 ? firstBeatTime : undefined}
        loopEndAt={loopEndAt}
        ghostRegion={ghostRegion}
      />
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={importMarkers}
      />
    </div>
  )
})

export default WarpView
