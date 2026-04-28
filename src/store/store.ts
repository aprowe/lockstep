import { configureStore } from '@reduxjs/toolkit'
import videoReducer from './slices/videoSlice'
import uiReducer from './slices/uiSlice'
import warpReducer from './slices/warpSlice'
import regionReducer from './slices/regionSlice'
import historyReducer from './slices/historySlice'
import sceneReducer from './slices/sceneSlice'
import thumbnailsReducer from './slices/thumbnailsSlice'
import settingsReducer from './slices/settingsSlice'
import listsReducer from './slices/listsSlice'
import { persistenceMiddleware } from './middleware/persistenceMiddleware'
import { historyMiddleware } from './middleware/historyMiddleware'
import { revealPlayheadMiddleware } from './middleware/revealPlayheadMiddleware'

export const store = configureStore({
  reducer: {
    video: videoReducer,
    ui: uiReducer,
    warp: warpReducer,
    region: regionReducer,
    history: historyReducer,
    scene: sceneReducer,
    thumbnails: thumbnailsReducer,
    settings: settingsReducer,
    lists: listsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .prepend(persistenceMiddleware.middleware)
      .prepend(historyMiddleware.middleware)
      .prepend(revealPlayheadMiddleware.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

// Dev-only: expose the store so Playwright screenshot tests can seed state.
// Stripped from production builds via Vite's import.meta.env.DEV constant.
if (import.meta.env.DEV) {
  ;(window as unknown as { __STORE__: typeof store }).__STORE__ = store
}
