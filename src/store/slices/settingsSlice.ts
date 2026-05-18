import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export const THEMES = [
  'warm-dark',
  'neon-rhythm',
  'violet-dusk',
  'tokyo-night',
  'catppuccin-mocha',
  'obsidian-bloom',
  'paper-light',
  'slate-light',
] as const
export type Theme = typeof THEMES[number]

interface SettingsState {
  /** Output width of extracted thumbnails in pixels. Changing this invalidates
   *  the on-disk cache (backend purges old jpgs at the next priority push). */
  thumbWidth: number
  /** Max number of cached thumbnails per video before LRU eviction. */
  maxCachedFrames: number
  /** Active color theme. The active theme name is reflected onto
   *  `<html data-theme="…">` by App.tsx so theme tokens cascade. */
  theme: Theme
  /** Anthropic API key for the in-app assistant panel. Stored locally only
   *  (localStorage); never logged or transmitted anywhere besides
   *  api.anthropic.com when the user actually sends a query. */
  anthropicApiKey: string
  /** Claude model id used by the assistant. Defaults to the latest opus. */
  assistantModel: string
  /** Google Gemini API key. Used by the gemini extension to send the active
   *  video to Gemini's video-understanding endpoint for whole-clip analysis
   *  (e.g. "find every scene with a horse"). Empty disables the extension. */
  geminiApiKey: string
  /** Gemini model id. Default is the fastest video-capable variant; the
   *  pro variant is more accurate but slower. */
  geminiModel: string
  /** Lerp-animate the timeline view window when scrolling/panning. */
  smoothPan: boolean
}

const DEFAULTS: SettingsState = {
  thumbWidth: 120,
  maxCachedFrames: 2000,
  theme: 'obsidian-bloom',
  anthropicApiKey: '',
  assistantModel: 'claude-opus-4-7',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  smoothPan: true,
}

const STORAGE_KEY = 'lockstep.settings.v1'

function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v)
}

function loadFromStorage(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw)
    return {
      thumbWidth: typeof parsed.thumbWidth === 'number' ? parsed.thumbWidth : DEFAULTS.thumbWidth,
      maxCachedFrames: typeof parsed.maxCachedFrames === 'number' ? parsed.maxCachedFrames : DEFAULTS.maxCachedFrames,
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULTS.theme,
      anthropicApiKey: typeof parsed.anthropicApiKey === 'string' ? parsed.anthropicApiKey : DEFAULTS.anthropicApiKey,
      assistantModel: typeof parsed.assistantModel === 'string' && parsed.assistantModel.length > 0
        ? parsed.assistantModel
        : DEFAULTS.assistantModel,
      geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : DEFAULTS.geminiApiKey,
      geminiModel: typeof parsed.geminiModel === 'string' && parsed.geminiModel.length > 0
        ? parsed.geminiModel
        : DEFAULTS.geminiModel,
      smoothPan: typeof parsed.smoothPan === 'boolean' ? parsed.smoothPan : DEFAULTS.smoothPan,
    }
  } catch {
    return DEFAULTS
  }
}

function saveToStorage(state: SettingsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* storage full or unavailable — best effort */ }
}

const settingsSlice = createSlice({
  name: 'settings',
  initialState: loadFromStorage(),
  reducers: {
    setThumbWidth(state, action: PayloadAction<number>) {
      state.thumbWidth = Math.max(48, Math.min(480, Math.round(action.payload)))
      saveToStorage(state)
    },
    setMaxCachedFrames(state, action: PayloadAction<number>) {
      state.maxCachedFrames = Math.max(100, Math.min(20000, Math.round(action.payload)))
      saveToStorage(state)
    },
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload
      saveToStorage(state)
    },
    setAnthropicApiKey(state, action: PayloadAction<string>) {
      state.anthropicApiKey = action.payload
      saveToStorage(state)
    },
    setAssistantModel(state, action: PayloadAction<string>) {
      state.assistantModel = action.payload
      saveToStorage(state)
    },
    setGeminiApiKey(state, action: PayloadAction<string>) {
      state.geminiApiKey = action.payload
      saveToStorage(state)
    },
    setGeminiModel(state, action: PayloadAction<string>) {
      state.geminiModel = action.payload
      saveToStorage(state)
    },
    setSmoothPan(state, action: PayloadAction<boolean>) {
      state.smoothPan = action.payload
      saveToStorage(state)
    },
    resetSettings(state) {
      state.thumbWidth = DEFAULTS.thumbWidth
      state.maxCachedFrames = DEFAULTS.maxCachedFrames
      state.theme = DEFAULTS.theme
      // Keep API keys on reset — credentials, not UI preferences.
      state.assistantModel = DEFAULTS.assistantModel
      state.geminiModel = DEFAULTS.geminiModel
      saveToStorage(state)
    },
  },
})

export const {
  setThumbWidth,
  setMaxCachedFrames,
  setTheme,
  setAnthropicApiKey,
  setAssistantModel,
  setGeminiApiKey,
  setGeminiModel,
  setSmoothPan,
  resetSettings,
} = settingsSlice.actions
export default settingsSlice.reducer
