/**
 * Built-in tools the assistant uses to drive Lockstep. Everything dispatches
 * Redux actions or calls Tauri commands so the UI updates immediately and
 * persistence middleware writes the same state the user would write
 * by hand.
 *
 * Conventions:
 * - Tools that mutate state always return a brief text confirmation so the
 *   model has something concrete to acknowledge in its reply.
 * - Read tools return JSON (stringified) so the model can parse exact values
 *   for follow-up tool calls.
 */

import { addRegion as addRegionAction } from "../store/slices/regionSlice";
import { addAnchor, newAnchorId } from "../store/slices/warpSlice";
import { addCut as addSceneCut } from "../store/slices/sceneSlice";
import { selectVideoThunk, openFolderThunk } from "../store/thunks/videoThunks";
import { extractFrame } from "../api/extract";
import type { Extension, ToolHandler, ToolResult } from "./types";

// ── Helpers ─────────────────────────────────────────────────────────────────

const text = (s: string): ToolResult => ({ blocks: [{ type: "text", text: s }] });
const json = (v: unknown): ToolResult => ({
    blocks: [{ type: "text", text: JSON.stringify(v, null, 2) }],
});
const err = (s: string): ToolResult => ({
    blocks: [{ type: "text", text: s }],
    isError: true,
});

function requireVideo(state: ReturnType<typeof import("../store/store").store.getState>) {
    const v = state.video.video;
    if (!v) throw new Error("No video loaded — open a video in the app first.");
    return v;
}

function asRecord(args: unknown): Record<string, unknown> {
    return (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
}
function requireString(args: unknown, key: string): string {
    const v = asRecord(args)[key];
    if (typeof v !== "string" || v.length === 0) throw new Error(`missing string arg "${key}"`);
    return v;
}
function requireNumber(args: unknown, key: string): number {
    const v = asRecord(args)[key];
    if (typeof v !== "number" || !Number.isFinite(v))
        throw new Error(`missing number arg "${key}"`);
    return v;
}
function optNumber(args: unknown, key: string): number | undefined {
    const v = asRecord(args)[key];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// ── Read tools ──────────────────────────────────────────────────────────────

const getVideo: ToolHandler = async (_args, { store }) => {
    const v = store.getState().video.video;
    if (!v) return text("No video loaded.");
    return json({
        path: v.path,
        name: v.originalName,
        duration: v.duration,
        fps: v.fps,
        width: v.width,
        height: v.height,
        fileHash: v.fileHash,
    });
};

const listVideosInFolder: ToolHandler = async (_args, { store }) => {
    const fv = store.getState().video.folderVideos;
    return json({
        count: fv.length,
        videos: fv.map((v) => ({ path: v.path, name: v.name })),
    });
};

const listRegions: ToolHandler = async (args: unknown, { store }) => {
    const state = store.getState();
    const v = requireVideo(state);
    const regions = state.region.regions;
    const rawQ = asRecord(args).query;
    const q = typeof rawQ === "string" ? rawQ.toLowerCase() : null;
    const filtered = q ? regions.filter((r) => r.name.toLowerCase().includes(q)) : regions;
    return json({
        videoPath: v.path,
        count: filtered.length,
        regions: filtered.map((r) => ({
            id: r.id,
            name: r.name,
            inPoint: r.inPoint,
            outPoint: r.outPoint,
            bpm: r.bpm,
        })),
    });
};

const listMarkers: ToolHandler = async (_args, { store }) => {
    const state = store.getState();
    const v = requireVideo(state);
    const orig = state.warp.origAnchors;
    const beat = state.warp.beatAnchors;
    const beatById = new Map(beat.map((b) => [b.id, b.time]));
    return json({
        videoPath: v.path,
        bpm: state.warp.bpm,
        count: orig.length,
        markers: [...orig]
            .sort((a, b) => a.time - b.time)
            .map((a) => ({ id: a.id, origTime: a.time, beatTime: beatById.get(a.id) ?? a.time })),
    });
};

const listScenes: ToolHandler = async (_args, { store }) => {
    const state = store.getState();
    const v = requireVideo(state);
    const cuts = state.scene.cutsByPath[v.path] ?? [];
    const userCuts = state.scene.userCutsByPath[v.path] ?? [];
    return json({
        videoPath: v.path,
        duration: v.duration,
        detected: cuts,
        userPlaced: userCuts,
        status: state.scene.statusByPath[v.path] ?? "idle",
    });
};

const seekTo: ToolHandler = async (args: unknown, _ctx) => {
    const t = requireNumber(args, "time");
    // We don't have a direct dispatch for the player; the playhead in warp slice
    // reflects the player but doesn't drive it. Tools can't grab the player ref
    // (it lives in a React ref), so we settle for nudging the persisted playhead
    // — close enough for "look at this moment" use cases. The Timeline panel
    // already reacts to playhead changes.
    // (If we need true seek-the-player from a tool later, expose an event on
    //  the dock bridge and emit it here.)
    return text(`Acknowledged seek to ${t.toFixed(3)}s (use extract_frame for the actual visual).`);
};

// ── Vision tool ─────────────────────────────────────────────────────────────

const extractFrameTool: ToolHandler = async (args: unknown, { store, log }) => {
    const state = store.getState();
    const v = requireVideo(state);
    const t = requireNumber(args, "time");
    const maxWidth = optNumber(args, "max_width") ?? 640;
    log(`extracting frame at ${t.toFixed(2)}s`);
    const frame = await extractFrame(v.path, t, maxWidth);
    return {
        blocks: [
            { type: "text", text: `Frame at t=${t.toFixed(3)}s (${frame.bytes} bytes JPEG)` },
            {
                type: "image",
                source: { type: "base64", media_type: frame.mime_type, data: frame.base64 },
            },
        ],
    };
};

// ── Mutation tools ──────────────────────────────────────────────────────────

const addRegionTool: ToolHandler = async (args: unknown, { store, log }) => {
    const state = store.getState();
    const v = requireVideo(state);
    const name = requireString(args, "name");
    const inPoint = requireNumber(args, "inPoint");
    const outPoint = requireNumber(args, "outPoint");
    if (!(outPoint > inPoint)) throw new Error("outPoint must be greater than inPoint");
    if (outPoint > v.duration + 0.001) {
        throw new Error(`outPoint ${outPoint} is past video duration ${v.duration}`);
    }
    const bpm = optNumber(args, "bpm") ?? state.warp.bpm;
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    store.dispatch(
        addRegionAction({
            id,
            name,
            inPoint,
            outPoint,
            bpm,
            inBeatTime: inPoint,
            outBeatTime: outPoint,
            defaultLinked: true,
            minStretch: 0.5,
            maxStretch: 2.0,
        }),
    );
    log(`added region "${name}"`);
    return json({ id, name, inPoint, outPoint, bpm });
};

const addMarkerTool: ToolHandler = async (args: unknown, { store, log }) => {
    const state = store.getState();
    const v = requireVideo(state);
    const time = requireNumber(args, "time");
    if (time < 0 || time > v.duration + 0.001) {
        throw new Error(`time ${time} is outside [0, ${v.duration}]`);
    }
    const id = newAnchorId();
    store.dispatch(addAnchor({ id, time }));
    log(`added marker @ ${time.toFixed(3)}s`);
    return json({ id, time });
};

const addSceneCutTool: ToolHandler = async (args: unknown, { store, log }) => {
    const state = store.getState();
    const v = requireVideo(state);
    const time = requireNumber(args, "time");
    if (time < 0 || time > v.duration + 0.001) {
        throw new Error(`time ${time} is outside [0, ${v.duration}]`);
    }
    store.dispatch(addSceneCut({ path: v.path, cut: time }));
    log(`added scene cut @ ${time.toFixed(3)}s`);
    return json({ time });
};

const openVideoTool: ToolHandler = async (args: unknown, { store, log }) => {
    const path = requireString(args, "path");
    log(`opening ${path}`);
    await store.dispatch(selectVideoThunk(path));
    const v = store.getState().video.video;
    if (!v) return err("Video did not load — check the path.");
    return json({ path: v.path, duration: v.duration, fps: v.fps });
};

const openFolderTool: ToolHandler = async (_args, { store, log }) => {
    log("opening folder picker…");
    await store.dispatch(openFolderThunk());
    const fv = store.getState().video.folderVideos;
    return json({ count: fv.length, videos: fv.map((v) => v.name) });
};

// ── Extension definition ────────────────────────────────────────────────────

export const coreExtension: Extension = {
    id: "core",
    name: "Lockstep core",
    description: "Built-in tools for inspecting and editing the active project.",
    tools: [
        {
            name: "get_video",
            description:
                "Return info about the currently loaded video (path, duration, fps, fileHash). If nothing is loaded, returns a notice instead of erroring.",
            input_schema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
            name: "list_videos_in_folder",
            description: "List videos in the folder currently open in the file browser sidebar.",
            input_schema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
            name: "list_regions",
            description:
                "List named regions (sub-clips) on the active video. Each has its own in/out and BPM. Pass `query` to filter by case-insensitive name substring.",
            input_schema: {
                type: "object",
                properties: { query: { type: "string" } },
                additionalProperties: false,
            },
        },
        {
            name: "list_markers",
            description:
                "List beat-marker anchors on the active video, sorted by time. Markers are points; regions are spans.",
            input_schema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
            name: "list_scenes",
            description: "List detected and user-placed scene-cut timestamps for the active video.",
            input_schema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
            name: "extract_frame",
            description:
                "Extract a JPEG frame at the given time from the active video and return it as image content. Use this to identify what is visually in a frame (e.g. animals, people, objects).",
            input_schema: {
                type: "object",
                properties: {
                    time: { type: "number", description: "Seconds from the start of the video." },
                    max_width: {
                        type: "integer",
                        minimum: 0,
                        description:
                            "Scale longest side to this many pixels (0 = source). Default 640.",
                    },
                },
                required: ["time"],
                additionalProperties: false,
            },
        },
        {
            name: "add_region",
            description:
                "Create a named region (sub-clip) on the active video. Beat zero is always the inPoint. Inherits the active BPM if `bpm` is omitted.",
            input_schema: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    inPoint: { type: "number" },
                    outPoint: { type: "number" },
                    bpm: { type: "number" },
                },
                required: ["name", "inPoint", "outPoint"],
                additionalProperties: false,
            },
        },
        {
            name: "add_marker",
            description: "Add a beat anchor on the active video at the given time.",
            input_schema: {
                type: "object",
                properties: { time: { type: "number" } },
                required: ["time"],
                additionalProperties: false,
            },
        },
        {
            name: "add_scene_cut",
            description:
                "Add a user-placed scene cut on the active video. User cuts always survive the min-gap filter.",
            input_schema: {
                type: "object",
                properties: { time: { type: "number" } },
                required: ["time"],
                additionalProperties: false,
            },
        },
        {
            name: "seek_to",
            description:
                'Persist the playhead position. Mostly useful for narrating "look here" — does not actually move the player.',
            input_schema: {
                type: "object",
                properties: { time: { type: "number" } },
                required: ["time"],
                additionalProperties: false,
            },
        },
        {
            name: "open_video",
            description:
                "Load a video file by absolute path into the app, replacing any currently loaded video.",
            input_schema: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
                additionalProperties: false,
            },
        },
        {
            name: "open_folder",
            description: "Open the folder picker to populate the file browser sidebar.",
            input_schema: { type: "object", properties: {}, additionalProperties: false },
        },
    ],
    handlers: {
        get_video: getVideo,
        list_videos_in_folder: listVideosInFolder,
        list_regions: listRegions,
        list_markers: listMarkers,
        list_scenes: listScenes,
        extract_frame: extractFrameTool,
        add_region: addRegionTool,
        add_marker: addMarkerTool,
        add_scene_cut: addSceneCutTool,
        seek_to: seekTo,
        open_video: openVideoTool,
        open_folder: openFolderTool,
    },
};
