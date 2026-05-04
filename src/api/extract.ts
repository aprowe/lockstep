import { invoke } from '@tauri-apps/api/core'

export interface ExtractedFrame {
  /** Standard base64 (RFC 4648) of the JPEG bytes. Drop into a
   *  `data:image/jpeg;base64,…` URL or an Anthropic vision content block. */
  base64: string
  mime_type: string
  bytes: number
}

/**
 * Extract a single frame at `time` seconds from `path` and return it as a
 * base64 JPEG. Used by the assistant to feed frames into vision models.
 *
 * `maxWidth` scales the longest edge down. 0 keeps the source resolution.
 * Default is 640px which is plenty for visual identification but small
 * enough to keep API payloads quick.
 */
export async function extractFrame(
  path: string,
  time: number,
  maxWidth: number = 640,
): Promise<ExtractedFrame> {
  return invoke<ExtractedFrame>('extract_frame', {
    req: { path, time, max_width: maxWidth },
  })
}
