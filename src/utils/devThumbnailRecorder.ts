import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ThumbnailPriorityRequest } from "../api/thumbnails";

type RecordEntry =
    | {
          type: "session_start";
          ts: 0;
          wallTime: string;
          fps: number;
          fileHash: string;
          duration: number;
      }
    | {
          type: "priority_push";
          ts: number;
          fileHash: string;
          fps: number;
          duration: number;
          playheadFrame: number;
          regionFrames: [number, number][];
          markerFrames: number[];
          sceneFrames: number[];
          stripFrames?: number[];
          hoverFrames?: number[];
          viewportFrames: [number, number];
      }
    | {
          type: "session_end";
          ts: number;
          thumbStats: {
              count: number;
              avgMs: number;
              minMs: number;
              maxMs: number;
              p50Ms: number;
              p95Ms: number;
          };
      };

export interface RecorderStats {
    recording: boolean;
    priorityPushes: number;
    thumbnailsDone: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    p50Ms: number;
    p95Ms: number;
}

let _recording = false;
let _startTime = 0;
let _entries: RecordEntry[] = [];
let _timings: number[] = [];
let _pushCount = 0;
let _listeners: Set<() => void> = new Set();

let _snapshot: RecorderStats = {
    recording: false,
    priorityPushes: 0,
    thumbnailsDone: 0,
    avgMs: 0,
    minMs: 0,
    maxMs: 0,
    p50Ms: 0,
    p95Ms: 0,
};

function pct(sorted: number[], p: number): number {
    if (!sorted.length) return 0;
    return sorted[Math.min(Math.ceil(p * sorted.length) - 1, sorted.length - 1)];
}

function commit() {
    const sorted = [..._timings].sort((a, b) => a - b);
    const sum = sorted.reduce((s, t) => s + t, 0);
    _snapshot = {
        recording: _recording,
        priorityPushes: _pushCount,
        thumbnailsDone: _timings.length,
        avgMs: sorted.length ? sum / sorted.length : 0,
        minMs: sorted[0] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
        p50Ms: pct(sorted, 0.5),
        p95Ms: pct(sorted, 0.95),
    };
    _listeners.forEach((l) => l());
}

export function subscribe(cb: () => void): () => void {
    _listeners.add(cb);
    return () => _listeners.delete(cb);
}

export function getStats(): RecorderStats {
    return _snapshot;
}

export function startRecording(fps: number, fileHash: string, duration: number): void {
    _recording = true;
    _startTime = performance.now();
    _entries = [];
    _timings = [];
    _pushCount = 0;
    _entries.push({
        type: "session_start",
        ts: 0,
        wallTime: new Date().toISOString(),
        fps,
        fileHash,
        duration,
    });
    commit();
}

export function stopRecording(): void {
    _recording = false;
    commit();
}

export function recordPriorityPush(req: ThumbnailPriorityRequest): void {
    if (!_recording) return;
    _entries.push({
        type: "priority_push",
        ts: Math.round(performance.now() - _startTime),
        fileHash: req.fileHash,
        fps: req.fps,
        duration: req.duration,
        playheadFrame: req.playheadFrame,
        regionFrames: req.regionFrames,
        markerFrames: req.markerFrames,
        sceneFrames: req.sceneFrames,
        stripFrames: req.stripFrames,
        hoverFrames: req.hoverFrames,
        viewportFrames: req.viewportFrames,
    });
    _pushCount++;
    commit();
}

export function recordThumbnailDone(durationMs: number): void {
    if (!_recording) return;
    _timings.push(durationMs);
    commit();
}

export async function saveRecording(): Promise<boolean> {
    const s = _snapshot;
    const summary: RecordEntry = {
        type: "session_end",
        ts: Math.round(performance.now() - _startTime),
        thumbStats: {
            count: s.thumbnailsDone,
            avgMs: s.avgMs,
            minMs: s.minMs,
            maxMs: s.maxMs,
            p50Ms: s.p50Ms,
            p95Ms: s.p95Ms,
        },
    };
    const content = [..._entries, summary].map((e) => JSON.stringify(e)).join("\n");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    try {
        const path = await save({
            defaultPath: `thumb-recording-${stamp}.jsonl`,
            filters: [{ name: "JSONL Recording", extensions: ["jsonl"] }],
        });
        if (!path) return false;
        await invoke("write_text_file", { req: { path, content } });
        return true;
    } catch {
        return false;
    }
}
