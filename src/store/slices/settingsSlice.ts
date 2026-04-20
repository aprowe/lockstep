import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface SettingsState {
  /** Output width of extracted thumbnails in pixels. Changing this invalidates
   *  the on-disk cache (backend purges old jpgs at the next priority push). */
  thumbWidth: number
  /** Max number of cached thumbnails per video before LRU eviction. */
  maxCachedFrames: number
}

const DEFAULTS: SettingsState = {
  thumbWidth: 120,
  maxCachedFrames: 2000,
}

const STORAGE_KEY = 'lockstep.settings.v1'

function loadFromStorage(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw)
    return {
      thumbWidth: typeof parsed.thumbWidth === 'number' ? parsed.thumbWidth : DEFAULTS.thumbWidth,
      maxCachedFrames: typeof parsed.maxCachedFrames === 'number' ? parsed.maxCachedFrames : DEFAULTS.maxCachedFrames,
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
    resetSettings(state) {
      state.thumbWidth = DEFAULTS.thumbWidth
      state.maxCachedFrames = DEFAULTS.maxCachedFrames
      saveToStorage(state)
    },
  },
})

export const { setThumbWidth, setMaxCachedFrames, resetSettings } = settingsSlice.actions
export default settingsSlice.reducer
