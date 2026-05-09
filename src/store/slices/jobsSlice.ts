import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type JobKind = 'warp' | 'scene'
export type JobStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface Job {
  /** UUID returned by the backend `start_*` command. */
  id: string
  kind: JobKind
  /** Display name — region name for warp jobs, video filename for scene jobs. */
  label: string
  status: JobStatus
  /** 0..1. */
  progress: number
  /** Latest progress message; cleared on terminal status. */
  message?: string
  /** Set when status === 'error'. */
  error?: string
  /** Epoch ms — drives sort order so newest renders first. */
  startedAt: number
  finishedAt?: number
  /** Accumulated progress messages for the Log tab. */
  logs: string[]
  /** Folder where the output was saved — set after a successful save. */
  outputFolder?: string
}

interface JobsState {
  /** Newest-first; the panel renders straight off this list. */
  jobs: Job[]
}

const initialState: JobsState = {
  jobs: [],
}

const jobsSlice = createSlice({
  name: 'jobs',
  initialState,
  reducers: {
    addJob(
      state,
      action: PayloadAction<{ id: string; kind: JobKind; label: string }>,
    ) {
      const { id, kind, label } = action.payload
      // De-dupe — scene detection's listener can race the thunk that registers
      // the job, and we never want two rows for the same job_id.
      if (state.jobs.some(j => j.id === id)) return
      state.jobs.unshift({
        id, kind, label,
        status: 'running',
        progress: 0,
        startedAt: Date.now(),
        logs: [],
      })
    },
    updateJob(
      state,
      action: PayloadAction<{
        id: string
        progress?: number
        message?: string
        status?: JobStatus
        error?: string
        outputFolder?: string
      }>,
    ) {
      const { id, progress, message, status, error, outputFolder } = action.payload
      const job = state.jobs.find(j => j.id === id)
      if (!job) return
      if (typeof progress === 'number') job.progress = Math.max(0, Math.min(1, progress))
      if (typeof message === 'string') {
        job.message = message
        if (job.logs[job.logs.length - 1] !== message) job.logs.push(message)
      }
      if (status) {
        job.status = status
        if (status !== 'running') {
          job.finishedAt = Date.now()
          if (status === 'done') job.progress = 1
        }
      }
      if (typeof error === 'string') job.error = error
      if (typeof outputFolder === 'string') job.outputFolder = outputFolder
    },
    removeJob(state, action: PayloadAction<string>) {
      state.jobs = state.jobs.filter(j => j.id !== action.payload)
    },
    clearFinished(state) {
      state.jobs = state.jobs.filter(j => j.status === 'running')
    },
  },
})

export const { addJob, updateJob, removeJob, clearFinished } = jobsSlice.actions
export default jobsSlice.reducer
