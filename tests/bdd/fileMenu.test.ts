import { describeFeature, loadFeature } from '@amiceli/vitest-cucumber'
import { expect } from 'vitest'
import { addRecentFile, clearRecentFiles } from '../../src/store/slices/videoSlice'
import { makeStore } from '../helpers/setup'

const feature = await loadFeature('./spec/features/file-menu.feature')

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  let store: ReturnType<typeof makeStore>

  BeforeEachScenario(() => {
    store = makeStore()
  })

  // @behavior file-menu::36132c0a
  Scenario('A file opened shows up in recent files', ({ Given, When, And, Then }) => {
    Given('No files have been loaded', () => {
      expect(store.getState().video.recentFiles).toEqual([])
    })
    When('File A is loaded', () => {
      store.dispatch(addRecentFile('/videos/a.mp4'))
    })
    And('File B is loaded', () => {
      store.dispatch(addRecentFile('/videos/b.mp4'))
    })
    Then('File A and File B appear in recent files list', () => {
      const recent = store.getState().video.recentFiles
      expect(recent).toContain('/videos/a.mp4')
      expect(recent).toContain('/videos/b.mp4')
    })
  })

  // @behavior file-menu::96d4b613
  Scenario('Recent Files can be cleared', ({ Given, When, Then }) => {
    Given('File A and B are in recent files list', () => {
      store.dispatch(addRecentFile('/videos/a.mp4'))
      store.dispatch(addRecentFile('/videos/b.mp4'))
    })
    When('Recent files clear action is called', () => {
      store.dispatch(clearRecentFiles())
    })
    Then('Recent files is empty', () => {
      expect(store.getState().video.recentFiles).toHaveLength(0)
    })
  })

  // @behavior file-menu::d1dd405b
  Scenario('Recent Files keeps up to 10 entries', ({ Given, When, Then }) => {
    Given('File 1, 2, 3 to 10 are loaded in order', () => {
      for (let i = 1; i <= 10; i++) store.dispatch(addRecentFile(`/videos/${i}.mp4`))
    })
    When('File 11 is loaded', () => {
      store.dispatch(addRecentFile('/videos/11.mp4'))
    })
    Then('Recent files contains files 2-11', () => {
      const recent = store.getState().video.recentFiles
      expect(recent).toHaveLength(10)
      expect(recent).not.toContain('/videos/1.mp4')
      expect(recent).toContain('/videos/11.mp4')
    })
  })

  // @behavior file-menu::ec817b27
  Scenario('Recent Files lists files one', ({ Given, When, Then }) => {
    Given('File 1, 2, 3 to 10 are loaded in order', () => {
      for (let i = 1; i <= 10; i++) store.dispatch(addRecentFile(`/videos/${i}.mp4`))
    })
    When('File 3 is loaded', () => {
      store.dispatch(addRecentFile('/videos/3.mp4'))
    })
    Then('Recent files contains files in order 3, 1, 2, 4-10', () => {
      // After loading 1-10 in order, list is [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
      // Re-opening 3 should give [3, 10, 9, 8, 7, 6, 5, 4, 2, 1]
      const recent = store.getState().video.recentFiles
      expect(recent).toHaveLength(10)
      expect(recent[0]).toBe('/videos/3.mp4')
      expect(recent[1]).toBe('/videos/10.mp4')
      expect(recent[recent.length - 1]).toBe('/videos/1.mp4')
      expect(recent.filter(p => p === '/videos/3.mp4')).toHaveLength(1)
    })
  })
})
