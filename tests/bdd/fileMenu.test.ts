import { it, expect } from 'vitest'
import { addRecentFile, clearRecentFiles } from '../../src/store/slices/videoSlice'
import { behaviorTest } from '../helpers/runBehavior'
import { makeStore } from '../helpers/setup'

// file-menu::36132c0a
// A file opened shows up in recent files

behaviorTest('file-menu::36132c0a', () => {
  it('adds loaded files to the recent files list', () => {
    const store = makeStore()
    store.dispatch(addRecentFile('/videos/a.mp4'))
    store.dispatch(addRecentFile('/videos/b.mp4'))

    const recent = store.getState().video.recentFiles
    expect(recent).toContain('/videos/a.mp4')
    expect(recent).toContain('/videos/b.mp4')
  })
})

// file-menu::96d4b613
// Recent Files can be cleared

behaviorTest('file-menu::96d4b613', () => {
  it('clears all recent files', () => {
    const store = makeStore()
    store.dispatch(addRecentFile('/videos/a.mp4'))
    store.dispatch(addRecentFile('/videos/b.mp4'))

    store.dispatch(clearRecentFiles())

    expect(store.getState().video.recentFiles).toHaveLength(0)
  })
})

// file-menu::d1dd405b
// Recent Files keeps up to 10 entries

behaviorTest('file-menu::d1dd405b', () => {
  it('drops the oldest entry when more than 10 files are loaded', () => {
    const store = makeStore()
    for (let i = 1; i <= 10; i++) store.dispatch(addRecentFile(`/videos/${i}.mp4`))
    store.dispatch(addRecentFile('/videos/11.mp4'))

    const recent = store.getState().video.recentFiles
    expect(recent).toHaveLength(10)
    expect(recent).not.toContain('/videos/1.mp4')
    expect(recent).toContain('/videos/11.mp4')
  })
})

// file-menu::ec817b27
// Recent Files lists files one

behaviorTest('file-menu::ec817b27', () => {
  it('moves a re-opened file to the front without duplicating it', () => {
    const store = makeStore()
    for (let i = 1; i <= 10; i++) store.dispatch(addRecentFile(`/videos/${i}.mp4`))
    store.dispatch(addRecentFile('/videos/3.mp4'))

    const recent = store.getState().video.recentFiles
    expect(recent).toHaveLength(10)
    expect(recent[0]).toBe('/videos/3.mp4')
    expect(recent.filter(p => p === '/videos/3.mp4')).toHaveLength(1)
  })

  it('preserves the order of other files when re-opening one', () => {
    const store = makeStore()
    for (let i = 1; i <= 10; i++) store.dispatch(addRecentFile(`/videos/${i}.mp4`))
    // After loading 1-10 in order, list is [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    // Re-opening 3 should give [3, 10, 9, 8, 7, 6, 5, 4, 2, 1]
    store.dispatch(addRecentFile('/videos/3.mp4'))

    const recent = store.getState().video.recentFiles
    expect(recent[0]).toBe('/videos/3.mp4')
    expect(recent[1]).toBe('/videos/10.mp4')
    expect(recent[recent.length - 1]).toBe('/videos/1.mp4')
  })
})
