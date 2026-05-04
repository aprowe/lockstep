/**
 * Gemini extension. Two tools:
 *
 *   - `analyze_video(prompt)` — pose a free-form question about the active
 *     video and get a text answer back. Use for descriptions, transcripts,
 *     or anything where structured output isn't required.
 *
 *   - `find_video_segments(query, max_segments?)` — ask Gemini for all clips
 *     matching a description and get back a structured list of `{ start,
 *     end, label, confidence }` ranges. The orchestrating model (Claude)
 *     can then call `add_region` for each.
 *
 * Both tools transparently upload the active video to Gemini's Files API
 * the first time it's referenced, then reuse the cached file URI on
 * subsequent calls (cache lives ~47h, just under Gemini's 48h hard limit).
 */

import { store } from '../store/store'
import { analyzeWithVideo, uploadVideo } from './gemini'
import type { Extension, ToolHandler, ToolResult } from './types'

const text = (s: string): ToolResult => ({ blocks: [{ type: 'text', text: s }] })
const json = (v: unknown): ToolResult => ({
  blocks: [{ type: 'text', text: JSON.stringify(v, null, 2) }],
})

function requireVideoAndKey() {
  const state = store.getState()
  const v = state.video.video
  if (!v) throw new Error('No video loaded — open a video before asking Gemini about it.')
  const apiKey = state.settings.geminiApiKey
  if (!apiKey) {
    throw new Error('Gemini API key is not set. Add it in Settings → AI assistant.')
  }
  const model = state.settings.geminiModel
  return { video: v, apiKey, model }
}

// ── analyze_video ───────────────────────────────────────────────────────────

const analyzeVideo: ToolHandler = async (args: any, { log, signal }) => {
  const { video, apiKey, model } = requireVideoAndKey()
  const prompt = typeof args?.prompt === 'string' ? args.prompt : ''
  if (!prompt) throw new Error('missing string arg "prompt"')

  log('uploading video to Gemini…')
  const upload = await uploadVideo({
    apiKey, videoPath: video.path, fileHash: video.fileHash, signal,
    onProgress: (m) => log(m),
  })
  log(upload.cached ? 'analyzing (cached upload)…' : 'analyzing…')
  const result = await analyzeWithVideo({
    apiKey, model, prompt, fileUri: upload.uri, mimeType: upload.mimeType, signal,
  })
  return text(result.text || '(empty response)')
}

// ── find_video_segments ─────────────────────────────────────────────────────

const SEGMENTS_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start:      { type: 'number', description: 'Start time in seconds.' },
          end:        { type: 'number', description: 'End time in seconds (must be > start).' },
          label:      { type: 'string', description: 'Short description of what is in this segment.' },
          confidence: { type: 'number', description: 'Confidence 0..1 that the segment matches the query.' },
        },
        required: ['start', 'end', 'label'],
      },
    },
  },
  required: ['segments'],
}

interface RawSegment { start: number; end: number; label: string; confidence?: number }

const findVideoSegments: ToolHandler = async (args: any, { log, signal }) => {
  const { video, apiKey, model } = requireVideoAndKey()
  const query = typeof args?.query === 'string' ? args.query : ''
  if (!query) throw new Error('missing string arg "query"')
  const maxSegments = typeof args?.max_segments === 'number'
    ? Math.max(1, Math.min(50, Math.floor(args.max_segments)))
    : 20

  log('uploading video to Gemini…')
  const upload = await uploadVideo({
    apiKey, videoPath: video.path, fileHash: video.fileHash, signal,
    onProgress: (m) => log(m),
  })

  const prompt
    = `Find all segments in this video that match the query: "${query}".\n`
    + `Return at most ${maxSegments} segments, ordered by start time. `
    + `Each segment should tightly bound a single occurrence of the subject — `
    + `if the subject persists, prefer one long segment over many short ones, `
    + `but split when the visual context (camera, framing, location) changes. `
    + `The video is ${video.duration.toFixed(2)} seconds long; all timestamps `
    + `must fall within [0, ${video.duration.toFixed(2)}] and end > start.`

  log(upload.cached ? 'searching video (cached upload)…' : 'searching video…')
  const result = await analyzeWithVideo({
    apiKey, model, prompt,
    fileUri: upload.uri, mimeType: upload.mimeType,
    responseSchema: SEGMENTS_SCHEMA,
    signal,
  })

  const raw = (result.json as { segments?: RawSegment[] } | null)?.segments ?? []
  const cleaned = raw
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map(s => ({
      start:      Math.max(0, s.start),
      end:        Math.min(video.duration, s.end),
      label:      String(s.label ?? ''),
      confidence: typeof s.confidence === 'number' ? s.confidence : null,
    }))
    .filter(s => s.end > s.start)

  return json({
    query,
    videoPath:    video.path,
    videoDuration: video.duration,
    count:        cleaned.length,
    segments:     cleaned,
  })
}

// ── Extension ───────────────────────────────────────────────────────────────

export const geminiExtension: Extension = {
  id: 'gemini',
  name: 'Gemini video',
  description: 'Whole-video understanding via Google Gemini. Native temporal '
    + 'reasoning — much cheaper than per-frame analysis for long clips.',
  tools: [
    {
      name: 'analyze_video',
      description: 'Ask Gemini a free-form question about the entire active video and get a text answer. Good for descriptions, summaries, or anything where structure isn\'t required. The video is uploaded once and cached on Gemini\'s side for ~48 hours.',
      input_schema: {
        type: 'object',
        properties: { prompt: { type: 'string', description: 'The question to ask Gemini about the video.' } },
        required: ['prompt'],
        additionalProperties: false,
      },
    },
    {
      name: 'find_video_segments',
      description: 'Ask Gemini to locate every segment of the active video matching a query (e.g. "scenes with horses", "shots of someone dancing", "talking-head sections"). Returns structured {start, end, label, confidence} ranges. Combine with `add_region` to materialize the matches as named regions.',
      input_schema: {
        type: 'object',
        properties: {
          query:         { type: 'string',  description: 'What to search for, in natural language.' },
          max_segments:  { type: 'integer', minimum: 1, maximum: 50, description: 'Hard cap on segments returned. Default 20.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  ],
  handlers: {
    analyze_video:       analyzeVideo,
    find_video_segments: findVideoSegments,
  },
}
