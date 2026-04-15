import { configureStore } from '@reduxjs/toolkit'
import videoReducer from './slices/videoSlice'
import uiReducer from './slices/uiSlice'

export const store = configureStore({
  reducer: {
    video: videoReducer,
    ui: uiReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
