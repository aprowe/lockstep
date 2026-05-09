import { useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { clearFinished, removeJob, type Job, type JobStatus } from '../../store/slices/jobsSlice'
import { cancelJobThunk } from '../../store/thunks/jobsThunks'
import { useDockBridge } from '../DockContext'
import './TasksPanel.css'

const STATUS_LABEL: Record<JobStatus, string> = {
  running: 'Running',
  done: 'Done',
  error: 'Error',
  cancelled: 'Cancelled',
}

const KIND_LABEL: Record<Job['kind'], string> = {
  warp: 'Warp',
  scene: 'Scenes',
}

export default function TasksPanel() {
  const dispatch = useAppDispatch()
  const bridge = useDockBridge()
  const jobs = useAppSelector(s => s.jobs.jobs)

  const hasFinished = useMemo(
    () => jobs.some(j => j.status !== 'running'),
    [jobs],
  )

  return (
    <div className="tasks-panel">
      <div className="tasks-panel__header">
        <span className="tasks-panel__count">
          {jobs.length} {jobs.length === 1 ? 'task' : 'tasks'}
        </span>
        <button
          type="button"
          className="tasks-panel__clear"
          onClick={() => dispatch(clearFinished())}
          disabled={!hasFinished}
          title="Remove finished, errored, and cancelled tasks"
        >
          Clear finished
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="vj-empty-panel">No tasks yet</div>
      ) : (
        <ul className="tasks-panel__list">
          {jobs.map(job => (
            <li
              key={job.id}
              className={`tasks-panel__row tasks-panel__row--${job.status}`}
            >
              <div
                className="tasks-panel__row-head tasks-panel__row-head--clickable"
                onClick={() => bridge.openExportLog(job.id)}
              >
                <span className="tasks-panel__kind">{KIND_LABEL[job.kind]}</span>
                <span className="tasks-panel__label" title={job.label}>{job.label}</span>
                <span className="tasks-panel__status">
                  {job.status === 'running'
                    ? `${Math.round(job.progress * 100)}%`
                    : STATUS_LABEL[job.status]}
                </span>
              </div>
              {job.status === 'running' && (
                <div className="tasks-panel__bar" role="progressbar" aria-valuenow={Math.round(job.progress * 100)}>
                  <div
                    className="tasks-panel__bar-fill"
                    style={{ width: `${Math.max(2, Math.round(job.progress * 100))}%` }}
                  />
                </div>
              )}
              {job.message && job.status === 'running' && (
                <div className="tasks-panel__message" title={job.message}>{job.message}</div>
              )}
              {job.error && (
                <div className="tasks-panel__error" title={job.error}>{job.error}</div>
              )}
              <div className="tasks-panel__actions">
                {job.status === 'running' ? (
                  <button
                    type="button"
                    className="tasks-panel__btn tasks-panel__btn--cancel"
                    onClick={() => dispatch(cancelJobThunk(job.id))}
                    title="Stop this task"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    className="tasks-panel__btn"
                    onClick={() => dispatch(removeJob(job.id))}
                    title="Remove from list"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
