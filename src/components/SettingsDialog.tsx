import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
    setMaxCachedFrames,
    setThumbWidth,
    setTheme,
    setAnthropicApiKey,
    setAssistantModel,
    setGeminiApiKey,
    setGeminiModel,
    setSmoothPan,
    setSnappyPlayer,
    resetSettings,
    THEMES,
    type Theme,
} from "../store/slices/settingsSlice";
import { clearAllThumbnails } from "../api/thumbnails";
import "./SettingsDialog.css";

const ASSISTANT_MODELS: Array<{ id: string; label: string }> = [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7 (most capable)" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (balanced)" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast)" },
];

const GEMINI_MODELS: Array<{ id: string; label: string }> = [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (fast, cheap)" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (more accurate)" },
];

/** Rough JPEG-on-disk estimate. ffmpeg encodes thumbs at -q:v 5 which lands
 *  somewhere around 0.25 bytes/pixel for typical video content. Aspect is
 *  unknown until a video is loaded, so we assume 16:9 for the estimate. */
const BYTES_PER_PIXEL = 0.25;
function estimateCacheBytes(frames: number, width: number): number {
    const height = Math.round((width * 9) / 16);
    return frames * width * height * BYTES_PER_PIXEL;
}

function formatBytes(n: number): string {
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const THEME_LABELS: Record<Theme, string> = {
    "warm-dark": "Warm Dark",
    "neon-rhythm": "Neon Rhythm",
    "violet-dusk": "Violet Dusk",
    "tokyo-night": "Tokyo Night",
    "catppuccin-mocha": "Catppuccin Mocha",
    "obsidian-bloom": "Obsidian Bloom",
    "paper-light": "Paper Light",
    "slate-light": "Slate Light",
};

interface SettingsDialogProps {
    open: boolean;
    onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
    const dispatch = useAppDispatch();
    const thumbWidth = useAppSelector((s) => s.settings.thumbWidth);
    const maxCachedFrames = useAppSelector((s) => s.settings.maxCachedFrames);
    const theme = useAppSelector((s) => s.settings.theme);
    const smoothPan = useAppSelector((s) => s.settings.smoothPan);
    const snappyPlayer = useAppSelector((s) => s.settings.snappyPlayer);
    const apiKey = useAppSelector((s) => s.settings.anthropicApiKey);
    const assistantModel = useAppSelector((s) => s.settings.assistantModel);
    const geminiKey = useAppSelector((s) => s.settings.geminiApiKey);
    const geminiModel = useAppSelector((s) => s.settings.geminiModel);
    const [clearing, setClearing] = useState(false);
    const [cleared, setCleared] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [showGeminiKey, setShowGeminiKey] = useState(false);

    useEffect(() => {
        if (!open) return;
        // Capture phase + stopImmediatePropagation so Escape closes this modal
        // without also firing the menu-bar "Escape → Deselect" shortcut.
        const h = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopImmediatePropagation();
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", h, true);
        return () => window.removeEventListener("keydown", h, true);
    }, [open, onClose]);

    if (!open) return null;

    const handleClearAll = async () => {
        setClearing(true);
        try {
            await clearAllThumbnails();
            setCleared(true);
            setTimeout(() => setCleared(false), 2000);
        } finally {
            setClearing(false);
        }
    };

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="settings-dialog__header">
                    <span className="settings-dialog__title">Settings</span>
                    <button className="settings-dialog__close" onClick={onClose} title="Close">
                        ✕
                    </button>
                </div>

                <div className="settings-dialog__body">
                    <section className="settings-section">
                        <h3 className="settings-section__heading">Appearance</h3>

                        <div className="settings-row">
                            <label className="settings-row__label">
                                <span className="settings-row__title">Theme</span>
                                <span className="settings-row__hint">
                                    Color palette for the entire app.
                                </span>
                            </label>
                            <div className="settings-row__control">
                                <select
                                    className="settings-select"
                                    value={theme}
                                    onChange={(e) => dispatch(setTheme(e.target.value as Theme))}
                                >
                                    {THEMES.map((t) => (
                                        <option key={t} value={t}>
                                            {THEME_LABELS[t]}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="smooth-pan-toggle">
                                <span className="settings-row__title">Smooth pan</span>
                                <span className="settings-row__hint">
                                    Lerp-animate the timeline when scrolling or panning.
                                </span>
                            </label>
                            <div className="settings-row__control">
                                <input
                                    id="smooth-pan-toggle"
                                    type="checkbox"
                                    checked={smoothPan}
                                    onChange={(e) => dispatch(setSmoothPan(e.target.checked))}
                                />
                            </div>
                        </div>

                        <div className="settings-row">
                            <label className="settings-row__label" htmlFor="snappy-player-toggle">
                                <span className="settings-row__title">
                                    Snappy player (experimental)
                                </span>
                                <span className="settings-row__hint">
                                    Replace the HTML5 video element with an ffmpeg-fed canvas
                                    player. Faster scrub; audio sync is best-effort.
                                </span>
                            </label>
                            <div className="settings-row__control">
                                <input
                                    id="snappy-player-toggle"
                                    type="checkbox"
                                    checked={snappyPlayer}
                                    onChange={(e) => dispatch(setSnappyPlayer(e.target.checked))}
                                />
                            </div>
                        </div>
                    </section>

                    <section className="settings-section">
                        <h3 className="settings-section__heading">Thumbnails</h3>

                        <div className="settings-row">
                            <label className="settings-row__label">
                                <span className="settings-row__title">Thumbnail size</span>
                                <span className="settings-row__hint">
                                    Width in pixels. Changing wipes existing thumbnails.
                                </span>
                            </label>
                            <div className="settings-row__control">
                                <input
                                    type="range"
                                    min={48}
                                    max={480}
                                    step={8}
                                    value={thumbWidth}
                                    onChange={(e) =>
                                        dispatch(setThumbWidth(parseInt(e.target.value, 10)))
                                    }
                                />
                                <span className="settings-row__value">{thumbWidth}px</span>
                            </div>
                        </div>

                        <div className="settings-row">
                            <label className="settings-row__label">
                                <span className="settings-row__title">Cache size (per video)</span>
                                <span className="settings-row__hint">
                                    Max cached frames before oldest get evicted. ~
                                    {formatBytes(estimateCacheBytes(maxCachedFrames, thumbWidth))}{" "}
                                    per video{" "}
                                    <span className="settings-row__faint">(estimated, 16:9)</span>
                                </span>
                            </label>
                            <div className="settings-row__control">
                                <input
                                    type="range"
                                    min={200}
                                    max={10000}
                                    step={100}
                                    value={maxCachedFrames}
                                    onChange={(e) =>
                                        dispatch(setMaxCachedFrames(parseInt(e.target.value, 10)))
                                    }
                                />
                                <span className="settings-row__value">
                                    {maxCachedFrames.toLocaleString()}
                                </span>
                            </div>
                        </div>

                        <div className="settings-row">
                            <label className="settings-row__label">
                                <span className="settings-row__title">Clear thumbnail cache</span>
                                <span className="settings-row__hint">
                                    Deletes every cached thumbnail on disk.
                                </span>
                            </label>
                            <div className="settings-row__control settings-row__control--buttons">
                                <button
                                    className="settings-btn settings-btn--danger"
                                    onClick={handleClearAll}
                                    disabled={clearing}
                                >
                                    {clearing ? "Clearing…" : cleared ? "Cleared ✓" : "Clear all"}
                                </button>
                            </div>
                        </div>
                    </section>

                    <section className="settings-section">
                        <h3 className="settings-section__heading">AI assistant</h3>

                        <div className="settings-row">
                            <label className="settings-row__label">
                                <span className="settings-row__title">Anthropic API key</span>
                                <span className="settings-row__hint">
                                    Stored locally, sent only to api.anthropic.com when you run a
                                    query.
                                </span>
                            </label>
                            <div className="settings-row__control">
                                <input
                                    type={showKey ? "text" : "password"}
                                    className="settings-text-input"
                                    value={apiKey}
                                    onChange={(e) => dispatch(setAnthropicApiKey(e.target.value))}
                                    placeholder="sk-ant-…"
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    className="settings-btn settings-btn--ghost"
                                    onClick={() => setShowKey((s) => !s)}
                                    title={showKey ? "Hide key" : "Show key"}
                                >
                                    {showKey ? "Hide" : "Show"}
                                </button>
                            </div>
                        </div>

                        <div className="settings-row">
                            <label className="settings-row__label">
                                <span className="settings-row__title">Model</span>
                                <span className="settings-row__hint">
                                    Vision-capable Claude model used by the Assistant panel.
                                </span>
                            </label>
                            <div className="settings-row__control">
                                <select
                                    className="settings-select"
                                    value={assistantModel}
                                    onChange={(e) => dispatch(setAssistantModel(e.target.value))}
                                >
                                    {ASSISTANT_MODELS.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="settings-row">
                            <label className="settings-row__label">
                                <span className="settings-row__title">Gemini API key</span>
                                <span className="settings-row__hint">
                                    Optional. When set, the assistant can hand whole videos to
                                    Gemini for native temporal queries (e.g. "find scenes with
                                    horses") instead of analyzing frames one at a time.
                                </span>
                            </label>
                            <div className="settings-row__control">
                                <input
                                    type={showGeminiKey ? "text" : "password"}
                                    className="settings-text-input"
                                    value={geminiKey}
                                    onChange={(e) => dispatch(setGeminiApiKey(e.target.value))}
                                    placeholder="AIza…"
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    className="settings-btn settings-btn--ghost"
                                    onClick={() => setShowGeminiKey((s) => !s)}
                                    title={showGeminiKey ? "Hide key" : "Show key"}
                                >
                                    {showGeminiKey ? "Hide" : "Show"}
                                </button>
                            </div>
                        </div>

                        <div className="settings-row">
                            <label className="settings-row__label">
                                <span className="settings-row__title">Gemini model</span>
                                <span className="settings-row__hint">
                                    Used by analyze_video / find_video_segments tools.
                                </span>
                            </label>
                            <div className="settings-row__control">
                                <select
                                    className="settings-select"
                                    value={geminiModel}
                                    onChange={(e) => dispatch(setGeminiModel(e.target.value))}
                                >
                                    {GEMINI_MODELS.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </section>

                    <div className="settings-dialog__footer">
                        <button
                            className="settings-btn settings-btn--ghost"
                            onClick={() => dispatch(resetSettings())}
                        >
                            Reset to defaults
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
