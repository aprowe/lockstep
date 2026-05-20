/**
 * Shared types for the Assistant panel — the in-app AI chat that drives
 * Lockstep through a small "extension framework". Each extension registers
 * a set of tools the assistant can call; this module deliberately knows
 * nothing about Claude or any specific provider so the same registry can
 * eventually be exposed to MCP clients or other LLM SDKs.
 */

import type { store } from "../store/store";

// ── Anthropic-shaped content blocks ─────────────────────────────────────────
//
// We use the Anthropic content-block shape internally because that's where
// the messages end up — keeping one shape avoids a pile of glue conversions.

export type ContentBlock =
    | { type: "text"; text: string }
    | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
      };

export interface ToolDef {
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
    };
}

export interface ToolContext {
    /** Live Redux store. Tools read state via `getState()` and mutate via
     *  `dispatch(...)` so they hit the same code paths the UI does — no
     *  parallel mutation surface to keep in sync. */
    store: typeof store;
    /** Reports a one-line status to the panel as the tool runs. Optional —
     *  short tools can ignore it. */
    log: (message: string) => void;
    signal?: AbortSignal;
}

export interface ToolResult {
    blocks: ContentBlock[];
    /** When true, the wrapper tags the tool_result block with isError so the
     *  model can see the failure and try a different approach. */
    isError?: boolean;
}

export type ToolHandler = (args: unknown, ctx: ToolContext) => Promise<ToolResult>;

export interface Extension {
    id: string;
    name: string;
    description?: string;
    tools: ToolDef[];
    handlers: Record<string, ToolHandler>;
}

// ── Transcript shown in the panel ───────────────────────────────────────────

/** One entry in the conversation as the user sees it. The tool-use loop
 *  emits these incrementally so long runs feel responsive. */
export type TranscriptEntry =
    | { kind: "user"; text: string }
    | { kind: "thought"; text: string }
    | {
          kind: "tool";
          name: string;
          input: unknown;
          status: "running" | "ok" | "error";
          summary?: string;
      }
    | { kind: "answer"; text: string }
    | { kind: "error"; text: string };
