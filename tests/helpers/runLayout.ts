/**
 * Layout verification helper.
 *
 * Usage:
 *   const { container } = renderSomething()
 *   assertLayoutMatches('main-toolbar', container)
 *
 * Looks for descendants with `data-layout-id="..."` or `data-layout-sep`
 * in document order and checks they match the spec in
 * generated/layout-registry.json (item presence, order, group separators).
 */

import { describe, it, expect } from 'vitest'
import registryData from '../../spec/generated/layout-registry.json'

interface LayoutItem { id: string; label: string; attrs?: Record<string, unknown> }
interface LayoutGroup { items: LayoutItem[] }
interface LayoutEntry {
  id: string
  name: string
  file: string
  groups: LayoutGroup[]
}

const registry = registryData.layouts as Record<string, LayoutEntry>

export function assertLayoutMatches(layoutId: string, container: Element | DocumentFragment) {
  const entry = registry[layoutId]
  if (!entry) {
    describe(`[layout:${layoutId}]`, () => {
      it('is defined', () => {
        throw new Error(`Layout "${layoutId}" not in registry. Run: npm run layouts:parse`)
      })
    })
    return
  }

  describe(`[layout:${layoutId}] ${entry.name}`, () => {
    // Read markers from the DOM in document order, dedupe consecutive duplicates
    const els = container.querySelectorAll('[data-layout-id], [data-layout-sep]')
    const markers: Array<{ id?: string; sep?: true }> = []
    els.forEach(el => {
      const id = el.getAttribute('data-layout-id')
      if (id) markers.push({ id })
      else markers.push({ sep: true })
    })
    const deduped = markers.filter((m, i) => {
      const prev = markers[i - 1]
      return !(prev && m.id && prev.id === m.id)
    })

    const actualIds = deduped.filter(m => m.id).map(m => m.id as string)
    const expectedIds = entry.groups.flatMap(g => g.items.map(i => i.id))
    const expectedGroups = entry.groups.map(g => g.items.map(i => i.id))

    it(`has ${expectedIds.length} items in ${entry.groups.length} groups`, () => {
      expect(actualIds.length).toBe(expectedIds.length)
    })

    it('items appear in spec order', () => {
      expect(actualIds).toEqual(expectedIds)
    })

    it('group separators split items into the correct groups', () => {
      const actualGroups: string[][] = [[]]
      for (const m of deduped) {
        if (m.sep) actualGroups.push([])
        else if (m.id) actualGroups[actualGroups.length - 1].push(m.id)
      }
      const filtered = actualGroups.filter(g => g.length > 0)
      expect(filtered).toEqual(expectedGroups)
    })
  })
}
