/**
 * Reason a frame is being requested. Same kebab-case strings on the wire
 * (Rust mirror in src-tauri/src/thumbnails.rs uses serde rename_all).
 */
export enum ThumbnailReason {
    Filmstrip = "filmstrip",
    Clips = "clips",
    ClipHover = "clip-hover",
    Scenes = "scenes",
    SceneHover = "scene-hover",
    Anchors = "anchors",
    AnchorHover = "anchor-hover",
}

export type HoverReason =
    | ThumbnailReason.ClipHover
    | ThumbnailReason.SceneHover
    | ThumbnailReason.AnchorHover;

export const ALL_REASONS: readonly ThumbnailReason[] = [
    ThumbnailReason.Filmstrip,
    ThumbnailReason.Clips,
    ThumbnailReason.ClipHover,
    ThumbnailReason.Scenes,
    ThumbnailReason.SceneHover,
    ThumbnailReason.Anchors,
    ThumbnailReason.AnchorHover,
];

export const STEADY_REASONS: readonly ThumbnailReason[] = [
    ThumbnailReason.Filmstrip,
    ThumbnailReason.Clips,
    ThumbnailReason.Scenes,
    ThumbnailReason.Anchors,
];
