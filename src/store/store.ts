import { configureStore } from '@reduxjs/toolkit'
import videoReducer from './slices/videoSlice'
import uiReducer from './slices/uiSlice'
import warpReducer from './slices/warpSlice'
import regionReducer from './slices/regionSlice'

export const store = configureStore({
  reducer: {
    video: videoReducer,
    ui: uiReducer,
    warp: warpReducer,
    region: regionReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
