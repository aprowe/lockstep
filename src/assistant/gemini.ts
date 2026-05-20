/**
 * Minimal Gemini client. Two surfaces:
 *
 *   1. `uploadVideo(...)`   — push a local video file at Gemini's Files API
 *      (resumable upload + polling until ACTIVE) and return its file URI.
 *
 *   2. `analyzeWithVideo(...)` — call generateContent with a prompt and the
 *      previously-uploaded file URI. Returns the model's text response
 *      (concatenated across parts).
 *
 * The webview's asset protocol (`tauri://localhost/...`) is what lets us
 * read large local video files without bouncing them through Tauri IPC.
 *
 * Files cached at Gemini expire after 48 hours; uploads here cache the URI
 * by file fingerprint in localStorage so a second query against the same
 * video reuses the existing upload.
 */

import { convertFileSrc } from "@tauri-apps/api/core";

const FILES_BASE = "https://generativelanguage.googleapis.com";
const FILES_UPLOAD = `${FILES_BASE}/upload/v1beta/files`;
const MODELS_BASE = `${FILES_BASE}/v1beta/models`;

const CACHE_KEY = "lockstep.gemini.fileCache.v1";
/** Treat cached URIs as expired this many ms before Gemini's 48h hard limit
 *  so we don't try to use a file that's about to disappear mid-request. */
const CACHE_TTL_MS = 47 * 60 * 60 * 1000;

interface CachedUpload {
    uri: string;
    mimeType: string;
    uploadedAt: number;
    /** File fingerprint — see video.rs::file_fingerprint. Cache key. */
    fileHash: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface UploadedVideo {
    uri: string;
    mimeType: string;
    /** True when the URI was reused from cache (no upload happened). */
    cached: boolean;
}

export interface UploadOptions {
    apiKey: string;
    videoPath: string;
    fileHash: string;
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
}

export async function uploadVideo(opts: UploadOptions): Promise<UploadedVideo> {
    const { apiKey, videoPath, fileHash, signal, onProgress } = opts;
    if (!apiKey) throw new Error("Gemini API key is not set. Configure it in Settings.");

    const cached = readCache(fileHash);
    if (cached) {
        onProgress?.("reusing cached upload");
        return { uri: cached.uri, mimeType: cached.mimeType, cached: true };
    }

    const blob = await fetchLocalFile(videoPath, signal);
    const mimeType = blob.type || guessMimeType(videoPath);
    const displayName = videoPath.split(/[\\/]/).pop() ?? "video";

    onProgress?.(`uploading ${(blob.size / 1024 / 1024).toFixed(1)} MB…`);
    const uploadUrl = await initiateResumable(apiKey, displayName, blob.size, mimeType, signal);
    const file = await uploadAndFinalize(uploadUrl, blob, signal);

    let active = file;
    let polls = 0;
    while (active.state === "PROCESSING") {
        if (polls++ >= 60) throw new Error("Gemini file processing timed out (>60s)");
        onProgress?.(`processing on Gemini side… (${polls})`);
        await delay(1000, signal);
        active = await getFile(apiKey, active.name, signal);
    }
    if (active.state !== "ACTIVE") {
        throw new Error(`Gemini file ended in state ${active.state}`);
    }

    writeCache({
        uri: active.uri,
        mimeType: active.mimeType ?? mimeType,
        uploadedAt: Date.now(),
        fileHash,
    });
    return { uri: active.uri, mimeType: active.mimeType ?? mimeType, cached: false };
}

export interface AnalyzeOptions {
    apiKey: string;
    model: string;
    prompt: string;
    fileUri: string;
    mimeType: string;
    /** When set, asks the model to return JSON matching this schema. */
    responseSchema?: Record<string, unknown>;
    signal?: AbortSignal;
}

export interface GeminiAnalysis {
    text: string;
    /** Parsed JSON when responseSchema is set; null otherwise (or on parse failure). */
    json: unknown;
}

export async function analyzeWithVideo(opts: AnalyzeOptions): Promise<GeminiAnalysis> {
    const { apiKey, model, prompt, fileUri, mimeType, responseSchema, signal } = opts;
    if (!apiKey) throw new Error("Gemini API key is not set.");

    const url = `${MODELS_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body: Record<string, unknown> = {
        contents: [
            {
                role: "user",
                parts: [{ fileData: { fileUri, mimeType } }, { text: prompt }],
            },
        ],
    };
    if (responseSchema) {
        body.generationConfig = {
            responseMimeType: "application/json",
            responseSchema,
        };
    }

    const res = await fetch(url, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${truncate(await safeText(res), 500)}`);
    const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
    }

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("");
    let json: unknown = null;
    if (responseSchema && text.length > 0) {
        try {
            json = JSON.parse(text);
        } catch {
            json = null;
        }
    }
    return { text, json };
}

// ── Internals ───────────────────────────────────────────────────────────────

interface GeminiFile {
    name: string;
    uri: string;
    mimeType?: string;
    state: "PROCESSING" | "ACTIVE" | "FAILED" | string;
}

async function fetchLocalFile(path: string, signal?: AbortSignal): Promise<Blob> {
    const url = convertFileSrc(path);
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`failed to read local file ${path}: ${res.status}`);
    return res.blob();
}

async function initiateResumable(
    apiKey: string,
    displayName: string,
    size: number,
    mimeType: string,
    signal?: AbortSignal,
): Promise<string> {
    const res = await fetch(`${FILES_UPLOAD}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        signal,
        headers: {
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(size),
            "X-Goog-Upload-Header-Content-Type": mimeType,
            "content-type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: displayName } }),
    });
    if (!res.ok)
        throw new Error(`Gemini upload init ${res.status}: ${truncate(await safeText(res), 300)}`);
    const uploadUrl = res.headers.get("x-goog-upload-url") ?? res.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl) throw new Error("Gemini upload init: missing upload URL header");
    return uploadUrl;
}

async function uploadAndFinalize(
    uploadUrl: string,
    blob: Blob,
    signal?: AbortSignal,
): Promise<GeminiFile> {
    const res = await fetch(uploadUrl, {
        method: "POST",
        signal,
        headers: {
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
        },
        body: blob,
    });
    if (!res.ok)
        throw new Error(`Gemini upload ${res.status}: ${truncate(await safeText(res), 300)}`);
    const payload = (await res.json()) as { file?: GeminiFile };
    if (!payload.file) throw new Error("Gemini upload: missing `file` in response");
    return payload.file;
}

async function getFile(apiKey: string, name: string, signal?: AbortSignal): Promise<GeminiFile> {
    const res = await fetch(`${FILES_BASE}/v1beta/${name}?key=${encodeURIComponent(apiKey)}`, {
        signal,
    });
    if (!res.ok)
        throw new Error(`Gemini get-file ${res.status}: ${truncate(await safeText(res), 200)}`);
    return res.json() as Promise<GeminiFile>;
}

// ── Cache helpers ───────────────────────────────────────────────────────────

function readCache(fileHash: string): CachedUpload | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const map = JSON.parse(raw) as Record<string, CachedUpload>;
        const hit = map[fileHash];
        if (!hit) return null;
        if (Date.now() - hit.uploadedAt > CACHE_TTL_MS) return null;
        return hit;
    } catch {
        return null;
    }
}

function writeCache(entry: CachedUpload): void {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        const map = raw ? (JSON.parse(raw) as Record<string, CachedUpload>) : {};
        // Drop expired entries on every write so the cache doesn't grow forever.
        const now = Date.now();
        for (const [k, v] of Object.entries(map)) {
            if (now - v.uploadedAt > CACHE_TTL_MS) delete map[k];
        }
        map[entry.fileHash] = entry;
        localStorage.setItem(CACHE_KEY, JSON.stringify(map));
    } catch {
        /* best-effort cache; not fatal */
    }
}

// ── Misc ────────────────────────────────────────────────────────────────────

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(t);
                reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

const MIME_BY_EXT: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
};
function guessMimeType(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return MIME_BY_EXT[ext] ?? "video/mp4";
}

async function safeText(res: Response): Promise<string> {
    try {
        return await res.text();
    } catch {
        return "";
    }
}
function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
}
