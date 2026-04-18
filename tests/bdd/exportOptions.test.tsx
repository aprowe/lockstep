import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react/pure'
import { Provider } from 'react-redux'
import ExportDialog from '../../src/components/ExportDialog'
import * as warpApi from '../../src/api/warp'
import type { WarpRequest } from '../../src/api/warp'
import { makeStore } from '../helpers/setup'
import type { WarpData } from '../../src/types'

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

function renderDialog(opts: { videoFps?: number } = {}) {
  const store = makeStore()
  return render(
    <Provider store={store}>
      <ExportDialog
        open
        onClose={() => {}}
        warpData={warpData}
        videoPath="/videos/concert.mp4"
        originalName="concert.mp4"
        videoFps={opts.videoFps}
        loopBeats={null}
        addToEnd={false}
        trimToLoop={false}
        regions={[]}
        activeRegionId={null}
      />
    </Provider>,
  )
}

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let capturedReq: WarpRequest | null = null

  BeforeEachScenario(() => {
    cleanup()
    vi.clearAllMocks()
    capturedReq = null
    vi.mocked(warpApi.startWarp).mockImplementation(async req => {
      capturedReq = req
      return 'job-1'
    })
    vi.mocked(warpApi.listenWarpProgress).mockResolvedValue(() => {})
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
})
