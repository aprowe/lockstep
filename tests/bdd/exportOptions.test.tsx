import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react/pure'
import { Provider } from 'react-redux'
import ExportDialog from '../../src/components/ExportDialog'
import * as warpApi from '../../src/api/warp'
import type { WarpRequest, WarpProgressPayload, SaveToFolderRequest } from '../../src/api/warp'
import { setLastExportFolder } from '../../src/store/slices/uiSlice'
import { makeStore } from '../helpers/setup'
import type { WarpData, Region } from '../../src/types'

vi.mock('../../src/api/warp')

const feature = await loadFeature('./spec/features/export-options.feature')

const warpData: WarpData = {
  origAnchors: [{ id: 1, time: 5 }, { id: 2, time: 10 }],
  beatAnchors: [{ id: 1, time: 5 }, { id: 2, time: 11 }],
  bpm: 120,
  minStretch: 0.5,
  maxStretch: 2.0,
  beatZeroTime: 5,
  addToEnd: false,
}

const makeRegion = (id: string, inP: number, outP: number, bpm = 120): Region => ({
  id, name: id, inPoint: inP, outPoint: outP, bpm,
  minStretch: 0.5, maxStretch: 2.0, addToEnd: false,
})

function renderDialog(opts: {
  videoFps?: number
  regions?: Region[]
  activeRegionId?: string | null
  lastExportFolder?: string | null
  loopBeats?: number | null
} = {}) {
  const store = makeStore()
  if (opts.lastExportFolder !== undefined) {
    store.dispatch(setLastExportFolder(opts.lastExportFolder))
  }
  return render(
    <Provider store={store}>
      <ExportDialog
        open
        onClose={() => {}}
        warpData={warpData}
        videoPath="/videos/concert.mp4"
        originalName="concert.mp4"
        videoFps={opts.videoFps}
        loopBeats={opts.loopBeats ?? null}
        addToEnd={false}
        trimToLoop={false}
        regions={opts.regions ?? []}
        activeRegionId={opts.activeRegionId ?? null}
      />
    </Provider>,
  )
}

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let capturedReq: WarpRequest | null = null
  let warpCalls: WarpRequest[] = []
  let saveCalls: SaveToFolderRequest[] = []
  let progressCallbacks: Array<(p: WarpProgressPayload) => void> = []
  let nextJobId = 1

  /** Fire warp-progress event to ALL active listeners — they filter by job_id internally. */
  const fireProgress = (payload: WarpProgressPayload) => {
    for (const cb of progressCallbacks) cb(payload)
  }

  BeforeEachScenario(() => {
    cleanup()
    vi.clearAllMocks()
    capturedReq = null
    warpCalls = []
    saveCalls = []
    progressCallbacks = []
    nextJobId = 1
    vi.mocked(warpApi.startWarp).mockImplementation(async req => {
      capturedReq = req
      warpCalls.push(req)
      return `job-${nextJobId++}`
    })
    vi.mocked(warpApi.listenWarpProgress).mockImplementation(cb => {
      progressCallbacks.push(cb)
      return Promise.resolve(() => {
        progressCallbacks = progressCallbacks.filter(c => c !== cb)
      })
    })
    vi.mocked(warpApi.saveToFolder).mockImplementation(async req => {
      saveCalls.push(req)
      return `${req.dest_folder}/${req.file_name}`
    })
    vi.mocked(warpApi.revealInFolder).mockResolvedValue()
    vi.mocked(warpApi.writeTextFile).mockResolvedValue()
  })

  // @behavior export-options::66beba92
  Scenario('Interpolation Options', ({ Given, When, Then }) => {
    Given('I have a clip i would like to export', () => {
      renderDialog({ videoFps: 30 })
    })
    When('I check "Interpolate Frames"', () => {
      fireEvent.click(screen.getByLabelText('Interpolate Frames'))
    })
    Then(
      'A panel is revealed that lets me pick the interpolation method, including minterpolate and RIFE, and the target FPS,',
      () => {
        const panel = screen.getByLabelText('Interpolation Options')
        expect(panel).toBeTruthy()
        const method = screen.getByLabelText('Interpolation Method') as HTMLSelectElement
        const options = Array.from(method.options).map(o => o.textContent)
        expect(options).toContain('minterpolate')
        expect(options).toContain('RIFE')
        const fpsInput = screen.getByLabelText('Target FPS') as HTMLInputElement
        expect(fpsInput.value).toBe('30')
      },
    )
  })

  // @behavior export-options::ee086472
  Scenario('User Exports Frame Interpolated Video', ({ Given, When, And, Then }) => {
    Given('I have a clip i would like to export', () => {
      renderDialog()
    })
    When('I check "Interpolate Frames"', () => {
      fireEvent.click(screen.getByLabelText('Interpolate Frames'))
    })
    And('Fill in 60 FPS in the provided input', () => {
      const input = screen.getByDisplayValue('60') as HTMLInputElement
      fireEvent.change(input, { target: { value: '60' } })
    })
    And('I click export', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Process' }))
    })
    Then(
      'my output video will run at 60 FPS consitently, with interpolated frames to control the variable speed',
      async () => {
        await waitFor(() => expect(warpApi.startWarp).toHaveBeenCalled())
        expect(capturedReq?.interp_fps).toBe(60)
      },
    )
  })

  // @behavior export-options::bfc3070e
  // Actual assertions live in src-tauri/tests/export_save.rs
  // (save_to_folder_creates_missing_parent_directories). This stub exists
  // only so vitest-cucumber stops complaining about an un-bound scenario.
  Scenario("Export to a folder whose parents don't exist creates them", ({ Given, When, Then, And }) => {
    Given('I have a processed clip ready to save', () => {})
    When('I export to a folder path whose parent directories do not yet exist', () => {})
    Then('the missing parent directories are created', () => {})
    And('the output file lands at the expected nested path', () => {})
  })

  // @behavior export-options::5f05369b
  Scenario('User Exports PTS set Video (Default)', ({ Given, When, And, Then }) => {
    Given('I have a clip i would like to export', () => {
      renderDialog()
    })
    When('I leave options as default', () => {
      // Defaults: Interpolate Frames off, Normalize BPM off. No action needed.
    })
    And('I click export', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Process' }))
    })
    Then(
      'my output video will run at with PTS set to control the variable speed',
      async () => {
        await waitFor(() => expect(warpApi.startWarp).toHaveBeenCalled())
        expect(capturedReq?.interp_fps).toBeNull()
      },
    )
  })

  // ── Batch / progress scenarios ─────────────────────────────────────────────
  // The batch scenarios drive process() with three regions and the warp/save
  // APIs mocked. Renders are gated on warpCalls.length so we can assert that
  // earlier saves landed BEFORE later renders even started — the whole point
  // of moving saveToFolder inside the loop.

  const threeRegions: Region[] = [
    makeRegion('a', 0,  10),
    makeRegion('b', 10, 20),
    makeRegion('c', 20, 30),
  ]

  // @behavior export-options::9a6cb1c6
  Scenario('Batch export saves each clip to the destination as it finishes', ({ Given, And, When, Then }) => {
    Given('I have three clips selected for batch export', () => {
      renderDialog({ regions: threeRegions, lastExportFolder: '/dest' })
      fireEvent.click(screen.getByLabelText('All Regions'))
    })
    And('a destination folder is set', () => {
      // lastExportFolder set above
    })
    When('the export begins', async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Process/ }))
      // Render kicks off clip 1
      await waitFor(() => expect(warpCalls.length).toBe(1))
    })
    Then('each clip is written into the destination folder the moment its render completes', async () => {
      // Finish clip 1 → its save MUST run before clip 2's warp starts.
      fireProgress({ job_id: 'job-1', status: 'done', output_path: '/tmp/a.mp4' })
      await waitFor(() => expect(saveCalls.length).toBe(1))
      expect(saveCalls[0].source_path).toBe('/tmp/a.mp4')
      expect(saveCalls[0].dest_folder).toBe('/dest')

      // ...then clip 2 begins and finishes
      await waitFor(() => expect(warpCalls.length).toBe(2))
      fireProgress({ job_id: 'job-2', status: 'done', output_path: '/tmp/b.mp4' })
      await waitFor(() => expect(saveCalls.length).toBe(2))
      expect(saveCalls[1].source_path).toBe('/tmp/b.mp4')
    })
    And("the next clip's render does not have to finish before earlier clips are saved", () => {
      // Clip 3 has not been *signaled done* — yet clips 1 and 2 are already
      // saved on disk. (The render for clip 3 may have started in the next
      // loop iteration; it just hasn't completed.)
      expect(saveCalls.length).toBe(2)
      expect(saveCalls.find(s => s.source_path === '/tmp/c.mp4')).toBeUndefined()
    })
  })

  // @behavior export-options::fac99f99
  Scenario('Batch export continues past a failed clip', ({ Given, And, When, Then }) => {
    Given('I have three clips selected for batch export', () => {
      renderDialog({ regions: threeRegions, lastExportFolder: '/dest' })
      fireEvent.click(screen.getByLabelText('All Regions'))
    })
    And('a destination folder is set', () => {})
    When('the second clip fails to render', async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Process/ }))
      await waitFor(() => expect(warpCalls.length).toBe(1))
      // Clip 1 succeeds and is saved
      fireProgress({ job_id: 'job-1', status: 'done', output_path: '/tmp/a.mp4' })
      await waitFor(() => expect(saveCalls.length).toBe(1))
      // Clip 2 starts then errors
      await waitFor(() => expect(warpCalls.length).toBe(2))
      fireProgress({ job_id: 'job-2', status: 'error', error: 'ffmpeg blew up' })
    })
    Then('the first clip is already in the destination folder and is not removed', () => {
      // saveCalls[0] still references clip 1 — nothing erased it
      expect(saveCalls.find(s => s.source_path === '/tmp/a.mp4')).toBeTruthy()
    })
    And('the third clip is still rendered and saved', async () => {
      // The loop should advance to clip 3 despite clip 2's failure
      await waitFor(() => expect(warpCalls.length).toBe(3))
      fireProgress({ job_id: 'job-3', status: 'done', output_path: '/tmp/c.mp4' })
      await waitFor(() => expect(saveCalls.length).toBe(2))
      expect(saveCalls[1].source_path).toBe('/tmp/c.mp4')
    })
    And('the failure is reported in the export log without aborting the batch', async () => {
      // The error line shows up in the visible log
      const log = await screen.findByLabelText('Export Log')
      expect(log.textContent).toMatch(/ffmpeg blew up/)
    })
  })

  // @behavior export-options::d219ae15
  Scenario("The {beats} token in the filename pattern resolves to the clip's beat count", ({ Given, And, When, Then }) => {
    // Region span 16s @ 120bpm → round(16 * 120 / 60) = 32 beats.
    const region = makeRegion('verse', 0, 16, 120)

    Given('the filename pattern contains the {beats} token', () => {
      renderDialog({
        regions: [region],
        activeRegionId: 'verse',
        lastExportFolder: '/dest',
        // Deliberately set loopBeats to a different number — the bug was that
        // {beats} resolved to loopBeats rather than the region's own count.
        loopBeats: 4,
      })
      const patternInput = screen.getByLabelText('Filename Pattern') as HTMLInputElement
      fireEvent.change(patternInput, { target: { value: '{name}_{beats}beats' } })
    })
    And('a region with 32 beats is being exported', () => {
      // current mode + active region 'verse' already configured
    })
    When('the export filename is generated for that region', async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Process/ }))
      await waitFor(() => expect(warpCalls.length).toBe(1))
      fireProgress({ job_id: 'job-1', status: 'done', output_path: '/tmp/verse.mp4' })
      await waitFor(() => expect(saveCalls.length).toBe(1))
    })
    Then('{beats} is replaced with 32', () => {
      expect(saveCalls[0].file_name).toBe('verse_32beats.mp4')
    })
    And('the token is not left blank or replaced with the global loop-beats value', () => {
      // Would have produced 'verse_4beats.mp4' or 'verse_beats.mp4' under the bug.
      expect(saveCalls[0].file_name).not.toContain('_4beats')
      expect(saveCalls[0].file_name).not.toBe('verse_beats.mp4')
    })
  })

  // @behavior export-options::f6b6bac9
  Scenario('Show Folder button appears on the progress screen as soon as export begins', ({ Given, When, Then, And }) => {
    Given('a destination folder is set', () => {
      renderDialog({ lastExportFolder: '/dest' })
    })
    When('I click Export and processing starts', async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Process/ }))
      await waitFor(() => expect(warpCalls.length).toBe(1))
    })
    Then('a "Show Folder" button is visible on the progress screen', () => {
      expect(screen.getByRole('button', { name: /Show Folder/ })).toBeTruthy()
    })
    And('clicking it opens the destination folder in the OS file manager', () => {
      fireEvent.click(screen.getByRole('button', { name: /Show Folder/ }))
      expect(warpApi.revealInFolder).toHaveBeenCalledWith('/dest')
    })
    And('the button remains available for the rest of the export and after it finishes', async () => {
      // Finish the in-flight render — the post-export view also exposes a folder button.
      fireProgress({ job_id: 'job-1', status: 'done', output_path: '/tmp/a.mp4' })
      await waitFor(() =>
        expect(screen.queryAllByRole('button', { name: /Folder/ }).length).toBeGreaterThan(0),
      )
    })
  })
})
