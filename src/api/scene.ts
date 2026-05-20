import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface SceneDetectionProgressPayload {
    job_id: string;
    path?: string;
    percent?: number;
    status: "running" | "done" | "cancelled" | "error";
    /** A single cut time (seconds) emitted during running — lets the UI stream markers in. */
    cut?: number;
    /** Final sorted cut list, only present on `status: 'done'`. */
    cuts?: number[];
    /** Echo of the scan window the backend ran with, when one was supplied.
     *  Lets the slice replace only the cuts inside the scanned range on 'done'
     *  instead of trampling cuts outside it. */
    window?: { start: number; end: number } | null;
    error?: string;
}

export async function startSceneDetection(params: {
    path: string;
    threshold?: number;
    /** Source-time scan window. When omitted the full file is scanned. */
    start?: number;
    end?: number;
}): Promise<string> {
    return invoke<string>("start_scene_detection", { req: params });
}

export async function cancelSceneDetection(): Promise<void> {
    return invoke<void>("cancel_scene_detection");
}

export async function listenSceneProgress(
    cb: (payload: SceneDetectionProgressPayload) => void,
): Promise<UnlistenFn> {
    return listen<SceneDetectionProgressPayload>("scene-detection-progress", (e) => cb(e.payload));
}
