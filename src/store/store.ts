import { configureStore } from '@reduxjs/toolkit'
import videoReducer from './slices/videoSlice'
import uiReducer from './slices/uiSlice'
import warpReducer from './slices/warpSlice'
import regionReducer from './slices/regionSlice'
import historyReducer from './slices/historySlice'
import { persistenceMiddleware } from './middleware/persistenceMiddleware'
import { historyMiddleware } from './middleware/historyMiddleware'

export const store = configureStore({
  reducer: {
    video: videoReducer,
    ui: uiReducer,
    warp: warpReducer,
    region: regionReducer,
    history: historyReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .prepend(persistenceMiddleware.middleware)
      .prepend(historyMiddleware.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
