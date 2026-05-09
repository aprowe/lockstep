import { createAsyncThunk } from '@reduxjs/toolkit'
import type { RootState } from '../store'
import { listenWarpProgress, cancelWarp } from '../../api/warp'
import { cancelSceneDetection } from '../../api/scene'
import { updateJob } from '../slices/jobsSlice'

let warpUnlisten: (() => void) | null = null

/** Attach a single global listener to `warp-progress` events that mirrors
 *  every job's lifecycle into `jobsSlice`. ExportDialog still installs its
 *  own listener for its dialog-local UI (log, per-job progress) — both are
 *  filtered by job_id so they don't conflict.
 *
 *  Jobs are seeded by the dispatcher (ExportDialog → addJob) before
 *  startWarp resolves. If a `running` event arrives for an unknown id the
 *  reducer ignores the update; on `done`/`error`/`cancelled` we still try
 *  the update so a late-registered job can still hit a terminal state. */
export const ensureWarpListener = createAsyncThunk<void, void>(
  'jobs/ensureWarpListener',
  async (_, { dispatch }) => {
    if (warpUnlisten) return
    warpUnlisten = await listenWarpProgress(payload => {
      const { job_id, percent, message, status, error } = payload
      if (!job_id) return
      if (status === 'running') {
        dispatch(updateJob({
          id: job_id,
          progress: percent,
          message,
          status: 'running',
        }))
      } else if (status === 'done') {
        dispatch(updateJob({ id: job_id, status: 'done', progress: 1 }))
      } else if (status === 'error') {
        // The backend re-uses 'error' for cancelled when it doesn't have a
        // dedicated channel, but `start_warp` now distinguishes them.
        const cancelled = error === 'cancelled'
        dispatch(updateJob({
          id: job_id,
          status: cancelled ? 'cancelled' : 'error',
          error: cancelled ? undefined : (error ?? 'Unknown error'),
        }))
      } else if ((status as string) === 'cancelled') {
        dispatch(updateJob({ id: job_id, status: 'cancelled' }))
      }
    })
  },
)

/** Cancel a job by id, dispatching to the appropriate backend command for
 *  its kind. Scene detection's backend cancel is global (only one job at a
 *  time on that pipeline), so the kind drives which IPC we hit. */
export const cancelJobThunk = createAsyncThunk<void, string>(
  'jobs/cancel',
  async (id, { getState }) => {
    const state = getState() as RootState
    const job = state.jobs.jobs.find(j => j.id === id)
    if (!job || job.status !== 'running') return
    if (job.kind === 'warp') {
      await cancelWarp(id)
    } else if (job.kind === 'scene') {
      await cancelSceneDetection()
    }
  },
)
