/**
 * Tool-use loop: keep round-tripping with the model until it stops asking
 * for tools. Emits transcript entries via `onUpdate` so the panel can show
 * progress while the loop is still running.
 */

import { store } from '../store/store'
import { callTool, listAllTools } from './registry'
import type { ContentBlock, TranscriptEntry } from './types'
import { createMessage, DEFAULT_MODEL, type Message, type RequestBlock } from './anthropic'

const SYSTEM_PROMPT = `You are the Lockstep assistant, embedded in a desktop app for BPM-warping video to music.

You can drive the app through the provided tools — read project state (video info, markers, regions, scene cuts), extract video frames for vision-based identification, and create regions/markers/scene cuts when the user asks.

Guidelines:
- Operate on the currently loaded video unless the user names a different one. Most read tools error if no video is loaded — tell the user to open one.
- For "find <subject>" requests, prefer \`find_video_segments\` (Gemini, whole-video understanding, returns structured timestamps) when it's available — that's one upload + one call. Fall back to \`list_scenes\` + per-cut \`extract_frame\` only if Gemini is unavailable, the request needs precise frame-level inspection, or you've already established the subject and just need to verify a specific moment.
- For free-form questions about video content (summaries, descriptions, "what happens between 0:30 and 1:00"), use \`analyze_video\`.
- After getting segments back from \`find_video_segments\`, materialize each as a region with \`add_region\` using the returned label as the name (or a slight variant) — don't ask the user to confirm unless the segment count is unexpectedly large (>10).
- Times are in seconds, floating point. Be precise — round only when narrating to the user.
- Tools that mutate state apply immediately. Confirm the change in your reply but keep it brief.
- When you're done, write a one or two sentence summary of what you did or found.`

interface RunOptions {
  prompt: string
  apiKey: string
  model?: string
  /** Limit on round-trips with the model. Vision-heavy queries like
   *  "find horses" can need a lot of frame extractions; default high. */
  maxIterations?: number
  signal?: AbortSignal
  onUpdate: (entry: TranscriptEntry) => void
}

export async function runAssistant(opts: RunOptions): Promise<void> {
  const { prompt, apiKey, signal, onUpdate } = opts
  const model = opts.model ?? DEFAULT_MODEL
  const maxIterations = opts.maxIterations ?? 20

  onUpdate({ kind: 'user', text: prompt })

  const tools = listAllTools()
  const messages: Message[] = [{ role: 'user', content: prompt }]

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) {
      onUpdate({ kind: 'error', text: 'Cancelled.' })
      return
    }

    const response = await createMessage({
      apiKey,
      model,
      system: SYSTEM_PROMPT,
      tools,
      messages,
      signal,
    })

    // Echo any text the model emitted before its tool calls.
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim().length > 0) {
        onUpdate(
          response.stop_reason === 'tool_use'
            ? { kind: 'thought', text: block.text }
            : { kind: 'answer',  text: block.text },
        )
      }
    }

    if (response.stop_reason !== 'tool_use') {
      return
    }

    // Append the assistant turn (must include the tool_use blocks verbatim
    // so the next request's tool_result blocks reference valid ids).
    messages.push({ role: 'assistant', content: response.content as RequestBlock[] })

    // Run each tool the model asked for, then send all results back in
    // one user turn — Anthropic requires tool_result blocks to be the
    // *first* content of the next user message after a tool_use turn.
    const toolResults: RequestBlock[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      onUpdate({ kind: 'tool', name: block.name, input: block.input, status: 'running' })
      const result = await callTool(block.name, block.input, {
        store,
        signal,
        log: (msg) => onUpdate({
          kind: 'tool', name: block.name, input: block.input,
          status: 'running', summary: msg,
        }),
      })
      const summary = summarizeBlocks(result.blocks, result.isError)
      onUpdate({
        kind: 'tool',
        name: block.name,
        input: block.input,
        status: result.isError ? 'error' : 'ok',
        summary,
      })
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.blocks,
        is_error: result.isError,
      })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  onUpdate({
    kind: 'error',
    text: `Stopped after ${maxIterations} tool-use iterations without a final answer.`,
  })
}

function summarizeBlocks(blocks: ContentBlock[], isError?: boolean): string {
  const parts: string[] = []
  for (const b of blocks) {
    if (b.type === 'text') {
      const trimmed = b.text.trim()
      parts.push(trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed)
    } else if (b.type === 'image') {
      parts.push('[image]')
    }
  }
  const joined = parts.join(' · ')
  return isError ? `error: ${joined}` : joined
}
