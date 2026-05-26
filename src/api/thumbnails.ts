import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ThumbnailReason } from "./thumbnailReason";

export interface SetThumbnailWantsRequest {
    fileHash: string;
    videoPath: string;
    fps: number;
    byReason: Partial<Record<ThumbnailReason, number[]>>;
    maxCachedFrames?: number;
    thumbWidth?: number;
}

/** Replace the full wants state for one file. Backend extracts wanted-but-uncached
 *  frames and evicts unwanted frames in LRU order when over cap. */
export function setThumbnailWants(r: SetThumbnailWantsRequest): Promise<void> {
    return invoke("set_thumbnail_wants", {
        req: {
            file_hash: r.fileHash,
            video_path: r.videoPath,
            fps: r.fps,
            by_reason: r.byReason,
            max_cached_frames: r.maxCachedFrames,
            thumb_width: r.thumbWidth,
        },
    });
}

export function clearThumbnails(fileHash: string): Promise<void> {
    return invoke("clear_thumbnails", { fileHash });
}

export function clearAllThumbnails(): Promise<void> {
    return invoke("clear_all_thumbnails");
}

/** Mirrors `ThumbnailStats` in `src-tauri/src/thumbnails.rs`. */
export interface ThumbnailStats {
    file_hash: string;
    thumb_width: number;
    max_dynamic: number;
    generation: number;
    keyframes_probed: boolean;
    keyframes_count: number;
    active_workers: number;
    static_set: number;
    dynamic_set: number;
    ready_total: number;
    ready_static_only: number;
    ready_dynamic_only: number;
    ready_both: number;
    ready_dynamic_unwanted: number;
    pending: number;
    in_flight: number;
    lifetime_jobs: number;
    lifetime_failures: number;
    abandoned_frames: number;
    last_error: string | null;
}

export function getThumbnailStats(fileHash: string): Promise<ThumbnailStats | null> {
    return invoke<ThumbnailStats | null>("get_thumbnail_stats", { fileHash });
}

export interface ThumbnailReadyPayload {
    file_hash: string;
    frame: number;
    path: string;
}

export function listenThumbnailReady(cb: (p: ThumbnailReadyPayload) => void): Promise<UnlistenFn> {
    return listen<ThumbnailReadyPayload>("thumbnail-ready", (e) => cb(e.payload));
}
