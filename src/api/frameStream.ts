import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * Wire format of one frame as it arrives on the Channel — keep in sync with
 * `encode_frame_message` in `src-tauri/src/frame_stream.rs`.
 *
 *   offset  size  field
 *        0     4  index    (u32 LE) — frame # within the requested window
 *        4     8  pts      (f64 LE) — absolute presentation time in seconds
 *       12     4  jpeg_len (u32 LE) — bytes of JPEG that follow
 *       16   ...  jpeg     (jpeg_len bytes)
 */
const FRAME_HEADER_LEN = 16;

export interface DecodedFrameMessage {
    index: number;
    pts: number;
    /** Sliced Uint8Array view of the JPEG. Backed by the original ArrayBuffer
     *  delivered by the Channel; do NOT retain past one `createImageBitmap`
     *  call without copying. */
    jpeg: Uint8Array;
}

/** Decode the binary header + JPEG payload Rust sends on the Channel. */
export function decodeFrameMessage(buffer: ArrayBuffer): DecodedFrameMessage {
    const view = new DataView(buffer);
    const index = view.getUint32(0, true);
    const pts = view.getFloat64(4, true);
    const jpegLen = view.getUint32(12, true);
    const jpeg = new Uint8Array(buffer, FRAME_HEADER_LEN, jpegLen);
    return { index, pts, jpeg };
}

/**
 * Start a Rust-side MJPEG frame decode for the given window. The Rust side
 * pipes ffmpeg's MJPEG output onto the supplied Channel as raw binary
 * messages (header + JPEG). Returns the stream id — pass it to
 * `cancelFrameStream` to interrupt the decode.
 */
export function startFrameStream(args: {
    path: string;
    start: number;
    end: number;
    fps: number;
    width: number;
    onFrame: Channel<ArrayBuffer>;
}): Promise<number> {
    const { path, start, end, fps, width, onFrame } = args;
    return invoke<number>("start_frame_stream", {
        path,
        start,
        end,
        fps,
        width,
        onFrame,
    });
}

/** Kill an in-flight stream. Safe to call on an id that's already finished. */
export function cancelFrameStream(streamId: number): Promise<boolean> {
    return invoke<boolean>("cancel_frame_stream", { streamId });
}

/**
 * Decode a JPEG byte slice into an ImageBitmap suitable for canvas blit.
 * The Blob wrapper is needed because `createImageBitmap` doesn't accept a
 * raw ArrayBufferView directly.
 */
export function decodeJpeg(jpeg: Uint8Array): Promise<ImageBitmap> {
    return createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
}
