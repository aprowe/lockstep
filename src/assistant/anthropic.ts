/**
 * Thin Claude API client. Direct fetch (no SDK) to keep the bundle slim and
 * because the Anthropic SDK isn't designed for browser use anyway.
 *
 * The Tauri webview is browser-context, so we send
 * `anthropic-dangerous-direct-browser-access: true` — a header Anthropic
 * recognises explicitly for desktop apps that bring their own key.
 */

import type { ContentBlock, ToolDef } from "./types";

export const DEFAULT_MODEL = "claude-opus-4-7";

export type Role = "user" | "assistant";

export type RequestBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | {
          type: "tool_result";
          tool_use_id: string;
          content: ContentBlock[];
          is_error?: boolean;
      };

export interface Message {
    role: Role;
    content: string | RequestBlock[];
}

export type ResponseBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown };

export interface AnthropicResponse {
    id: string;
    model: string;
    role: "assistant";
    content: ResponseBlock[];
    stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | string;
    usage?: { input_tokens: number; output_tokens: number };
}

interface CreateMessageParams {
    apiKey: string;
    model: string;
    system?: string;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
    signal?: AbortSignal;
}

export async function createMessage(p: CreateMessageParams): Promise<AnthropicResponse> {
    if (!p.apiKey) throw new Error("Anthropic API key is not set. Configure it in Settings.");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: p.signal,
        headers: {
            "content-type": "application/json",
            "x-api-key": p.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
            model: p.model,
            max_tokens: p.maxTokens ?? 4096,
            system: p.system,
            tools: p.tools,
            messages: p.messages,
        }),
    });
    if (!res.ok) {
        const body = await safeReadText(res);
        throw new Error(`Anthropic ${res.status}: ${truncate(body, 500)}`);
    }
    return res.json() as Promise<AnthropicResponse>;
}

async function safeReadText(res: Response): Promise<string> {
    try {
        return await res.text();
    } catch {
        return "";
    }
}
function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
}
