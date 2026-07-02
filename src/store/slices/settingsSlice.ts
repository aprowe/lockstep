import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export const THEMES = [
    "warm-dark",
    "neon-rhythm",
    "violet-dusk",
    "tokyo-night",
    "catppuccin-mocha",
    "obsidian-bloom",
    "paper-light",
    "slate-light",
] as const;
export type Theme = (typeof THEMES)[number];

interface SettingsState {
    /** Output width of extracted thumbnails in pixels. Changing this invalidates
     *  the on-disk cache (backend purges old jpgs at the next priority push). */
    thumbWidth: number;
    /** Max number of cached thumbnails per video before LRU eviction. */
    maxCachedFrames: number;
    /** Active color theme. The active theme name is reflected onto
     *  `<html data-theme="…">` by App.tsx so theme tokens cascade. */
    theme: Theme;
    /** Lerp-animate the timeline view window when scrolling/panning. */
    smoothPan: boolean;
}

const DEFAULTS: SettingsState = {
    thumbWidth: 120,
    maxCachedFrames: 2000,
    theme: "obsidian-bloom",
    smoothPan: true,
};

const STORAGE_KEY = "lockstep.settings.v1";

function isTheme(v: unknown): v is Theme {
    return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}

function loadFromStorage(): SettingsState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULTS;
        const parsed = JSON.parse(raw);
        return {
            thumbWidth:
                typeof parsed.thumbWidth === "number" ? parsed.thumbWidth : DEFAULTS.thumbWidth,
            maxCachedFrames:
                typeof parsed.maxCachedFrames === "number"
                    ? parsed.maxCachedFrames
                    : DEFAULTS.maxCachedFrames,
            theme: isTheme(parsed.theme) ? parsed.theme : DEFAULTS.theme,
            smoothPan:
                typeof parsed.smoothPan === "boolean" ? parsed.smoothPan : DEFAULTS.smoothPan,
        };
    } catch {
        return DEFAULTS;
    }
}

function saveToStorage(state: SettingsState) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        /* storage full or unavailable — best effort */
    }
}

const settingsSlice = createSlice({
    name: "settings",
    initialState: loadFromStorage(),
    reducers: {
        setThumbWidth(state, action: PayloadAction<number>) {
            state.thumbWidth = Math.max(48, Math.min(480, Math.round(action.payload)));
            saveToStorage(state);
        },
        setMaxCachedFrames(state, action: PayloadAction<number>) {
            state.maxCachedFrames = Math.max(100, Math.min(20000, Math.round(action.payload)));
            saveToStorage(state);
        },
        setTheme(state, action: PayloadAction<Theme>) {
            state.theme = action.payload;
            saveToStorage(state);
        },
        setSmoothPan(state, action: PayloadAction<boolean>) {
            state.smoothPan = action.payload;
            saveToStorage(state);
        },
        resetSettings(state) {
            state.thumbWidth = DEFAULTS.thumbWidth;
            state.maxCachedFrames = DEFAULTS.maxCachedFrames;
            state.theme = DEFAULTS.theme;
            state.smoothPan = DEFAULTS.smoothPan;
            saveToStorage(state);
        },
    },
});

export const {
    setThumbWidth,
    setMaxCachedFrames,
    setTheme,
    setSmoothPan,
    resetSettings,
} = settingsSlice.actions;
export default settingsSlice.reducer;
