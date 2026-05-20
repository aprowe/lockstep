import { useEffect, useRef, useState } from "react";
import { useAppSelector } from "../store/hooks";
import { runAssistant } from "../assistant";
import type { TranscriptEntry } from "../assistant/types";
import "./AssistantPanel.css";

/**
 * Chat panel that drives Lockstep through the AI assistant. Lives inside
 * dockview as the `assistant` component (registered in PanelDock).
 *
 * Plumbing notes:
 * - Conversation history is local to the component on purpose. The transcript
 *   is mostly noisy tool calls and would bloat the persisted Redux store.
 * - We start a new run with `runAssistant`; it streams TranscriptEntry events
 *   back via `onUpdate` so the UI feels live during long vision-heavy queries.
 */
export default function AssistantPanel() {
    const apiKey = useAppSelector((s) => s.settings.anthropicApiKey);
    const model = useAppSelector((s) => s.settings.assistantModel);

    const [input, setInput] = useState("");
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [entries, setEntries] = useState<TranscriptEntry[]>([]);
    const abortRef = useRef<AbortController | null>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll the transcript to the bottom whenever a new entry lands so
    // long tool-use loops stay readable.
    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [entries.length]);

    const send = async () => {
        const prompt = input.trim();
        if (!prompt || running) return;
        if (!apiKey) {
            setError("Set your Anthropic API key in Settings to enable the assistant.");
            return;
        }
        setError(null);
        setInput("");
        setRunning(true);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            await runAssistant({
                prompt,
                apiKey,
                model,
                signal: controller.signal,
                onUpdate: (entry) => {
                    setEntries((prev) => mergeEntry(prev, entry));
                },
            });
        } catch (e: unknown) {
            const msg =
                typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
            setEntries((prev) => [...prev, { kind: "error", text: msg }]);
        } finally {
            abortRef.current = null;
            setRunning(false);
        }
    };

    const cancel = () => {
        abortRef.current?.abort();
    };

    const clear = () => {
        if (running) return;
        setEntries([]);
        setError(null);
    };

    return (
        <div className="assistant-panel">
            <div className="assistant-panel__header">
                <span className="assistant-panel__title">Assistant</span>
                <span className="assistant-panel__model">{model}</span>
                <button
                    className="assistant-panel__clear"
                    onClick={clear}
                    disabled={running || entries.length === 0}
                    title="Clear conversation"
                >
                    Clear
                </button>
            </div>

            <div className="assistant-panel__transcript" ref={scrollerRef}>
                {entries.length === 0 && !error && <EmptyHint hasKey={!!apiKey} />}
                {entries.map((e, i) => (
                    <TranscriptRow key={i} entry={e} />
                ))}
                {error && <div className="assistant-row assistant-row--error">{error}</div>}
            </div>

            <div className="assistant-panel__input">
                <textarea
                    className="assistant-panel__textarea"
                    placeholder={
                        apiKey
                            ? 'Ask the assistant — e.g. "find scenes with horses"'
                            : "Set your API key in Settings to begin…"
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        // Submit on plain Enter; Shift+Enter inserts a newline.
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        }
                    }}
                    rows={2}
                    disabled={running}
                />
                {running ? (
                    <button
                        className="assistant-panel__send assistant-panel__send--cancel"
                        onClick={cancel}
                    >
                        Cancel
                    </button>
                ) : (
                    <button
                        className="assistant-panel__send"
                        onClick={send}
                        disabled={!input.trim() || !apiKey}
                    >
                        Send
                    </button>
                )}
            </div>
        </div>
    );
}

function EmptyHint({ hasKey }: { hasKey: boolean }) {
    return (
        <div className="assistant-empty">
            <div className="assistant-empty__title">AI assistant</div>
            <div className="assistant-empty__body">
                Drive Lockstep with natural language. The assistant has tools to read your project
                (clips, anchors, scenes) and to extract frames so a vision-capable model can
                identify what&apos;s in the video.
            </div>
            <ul className="assistant-empty__examples">
                <li>&ldquo;Find scenes with horses and create a clip around each one.&rdquo;</li>
                <li>&ldquo;List my clips sorted by length.&rdquo;</li>
                <li>&ldquo;Add an anchor every 4 seconds for the first minute.&rdquo;</li>
            </ul>
            {!hasKey && (
                <div className="assistant-empty__note">
                    Add your Anthropic API key in <strong>Settings</strong> to begin.
                </div>
            )}
        </div>
    );
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
    if (entry.kind === "user") {
        return <div className="assistant-row assistant-row--user">{entry.text}</div>;
    }
    if (entry.kind === "thought") {
        return <div className="assistant-row assistant-row--thought">{entry.text}</div>;
    }
    if (entry.kind === "answer") {
        return <div className="assistant-row assistant-row--answer">{entry.text}</div>;
    }
    if (entry.kind === "error") {
        return <div className="assistant-row assistant-row--error">{entry.text}</div>;
    }
    // Tool row
    const dot = entry.status === "running" ? "⋯" : entry.status === "ok" ? "✓" : "✕";
    const cls =
        entry.status === "running"
            ? "tool--running"
            : entry.status === "ok"
              ? "tool--ok"
              : "tool--error";
    return (
        <div className={`assistant-row assistant-row--tool ${cls}`}>
            <span className="assistant-tool__dot">{dot}</span>
            <span className="assistant-tool__name">{entry.name}</span>
            <span className="assistant-tool__input">{formatToolInput(entry.input)}</span>
            {entry.summary && <span className="assistant-tool__summary">{entry.summary}</span>}
        </div>
    );
}

function formatToolInput(input: unknown): string {
    if (input == null) return "";
    if (typeof input !== "object") return String(input);
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) return "";
    const parts = entries.map(([k, v]) => {
        if (typeof v === "string" && v.length > 40) return `${k}=${v.slice(0, 37)}…`;
        if (typeof v === "number") return `${k}=${formatNumber(v)}`;
        return `${k}=${JSON.stringify(v)}`;
    });
    return parts.join(" ");
}

function formatNumber(n: number): string {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(3);
}

/**
 * Collapse consecutive updates for the same in-flight tool into one row so
 * the transcript doesn't grow a fresh entry every time the tool reports
 * progress via `log()`. Once a tool reaches ok/error we leave subsequent
 * entries alone.
 */
function mergeEntry(prev: TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
    if (entry.kind !== "tool") return [...prev, entry];
    const last = prev[prev.length - 1];
    if (
        last &&
        last.kind === "tool" &&
        last.status === "running" &&
        last.name === entry.name &&
        JSON.stringify(last.input) === JSON.stringify(entry.input)
    ) {
        const next = prev.slice(0, -1);
        next.push(entry);
        return next;
    }
    return [...prev, entry];
}
