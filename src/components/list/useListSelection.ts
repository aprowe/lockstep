import { useCallback, useRef } from 'react'

/**
 * Click + keyboard selection semantics shared by every list panel.
 *
 *   click            → set selection to [id], fire onActivate(id)
 *   ctrl/meta+click  → toggle id in selection (no activate)
 *   shift+click      → range from anchor to id (no activate)
 *
 * The "anchor" is the last single-clicked or activated id; shift-click
 * selects every visible item between anchor and the clicked id. Anchor
 * is reset whenever the caller-visible item list changes shape so a
 * stale anchor outside the list doesn't confuse range selection.
 *
 * onActivate is fired only on a plain click — it's the "open / focus this
 * one item" signal (e.g. seek the playhead, set as active region).
 */

export interface ListSelectionApi {
  isSelected: (id: string) => boolean
  /** Wire to a row's onClick. Pass the React event so modifiers are read. */
  handleRowClick: (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void
  /** Wire to the list container's onKeyDown. Returns true if handled. */
  handleKeyDown: (e: KeyboardEvent | React.KeyboardEvent) => boolean
}

interface UseListSelectionOpts {
  itemIds: string[]
  selectedIds: ReadonlySet<string>
  onSelectionChange: (ids: string[]) => void
  /** Fired on plain (non-modifier) click — the "open this one" intent. */
  onActivate?: (id: string) => void
  /** Fired on Delete / Backspace with selection non-empty. */
  onDelete?: (ids: string[]) => void
}

/** After deleting the selected ids, return the id that should take focus —
 *  the row right after the last deleted, or right before the first deleted
 *  if we're at the end. Null when no survivor exists (everything deleted). */
function pickSurvivor(itemIds: string[], selectedIds: ReadonlySet<string>): string | null {
  let firstIdx = -1
  let lastIdx = -1
  for (let i = 0; i < itemIds.length; i++) {
    if (selectedIds.has(itemIds[i])) {
      if (firstIdx < 0) firstIdx = i
      lastIdx = i
    }
  }
  if (firstIdx < 0) return null
  if (lastIdx + 1 < itemIds.length) return itemIds[lastIdx + 1]
  if (firstIdx - 1 >= 0) return itemIds[firstIdx - 1]
  return null
}

export function useListSelection({
  itemIds, selectedIds, onSelectionChange, onActivate, onDelete,
}: UseListSelectionOpts): ListSelectionApi {
  // Anchor is the last id that received a plain click — used as the start
  // of any subsequent shift+click range. Held in a ref so changing it
  // doesn't trigger renders.
  const anchorRef = useRef<string | null>(null)

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

  const handleRowClick = useCallback(
    (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      const additive = e.metaKey || e.ctrlKey
      const range = e.shiftKey

      if (range && anchorRef.current && itemIds.includes(anchorRef.current)) {
        // Range selection extends the existing selection from anchor to id.
        const a = itemIds.indexOf(anchorRef.current)
        const b = itemIds.indexOf(id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a <= b ? [a, b] : [b, a]
          const range = itemIds.slice(lo, hi + 1)
          // Union with existing selection so range-extending an already-
          // multi-selected list doesn't drop the previously selected ids.
          const next = new Set(selectedIds)
          for (const r of range) next.add(r)
          onSelectionChange([...next])
          return
        }
      }

      if (additive) {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        onSelectionChange([...next])
        anchorRef.current = id
        return
      }

      // Plain click — reset selection to just this id and fire activate.
      onSelectionChange([id])
      anchorRef.current = id
      onActivate?.(id)
    },
    [itemIds, selectedIds, onSelectionChange, onActivate],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent): boolean => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size === 0) return false
        // Pick the survivor before deletion: the row immediately after the
        // last selected item, or the row before the first selected item if
        // we're at the end. Falls through to no survivor when everything
        // visible is being deleted.
        const survivor = pickSurvivor(itemIds, selectedIds)
        onDelete?.([...selectedIds])
        if (survivor !== null) {
          onSelectionChange([survivor])
          anchorRef.current = survivor
          onActivate?.(survivor)
        }
        return true
      }
      // Cmd/Ctrl+A — select every visible row in this list. Scoped to
      // the focused list per the focus-scoping rule; doesn't reach into
      // other lists.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'a') {
        if (itemIds.length === 0) return false
        onSelectionChange([...itemIds])
        return true
      }
      // Cmd/Ctrl+D — clear this list's selection.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
        if (selectedIds.size === 0) return false
        onSelectionChange([])
        return true
      }
      // Up / Down — move the selection to the prev/next visible row and
      // fire activate, matching plain-click semantics. Anchor follows so
      // a subsequent shift+click extends from the new position.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (itemIds.length === 0) return false
        const dir = e.key === 'ArrowDown' ? 1 : -1
        // Pick the cursor — anchor first, else last selected, else edge.
        let cursor = anchorRef.current
        if (!cursor || !itemIds.includes(cursor)) {
          for (const id of itemIds) if (selectedIds.has(id)) cursor = id
        }
        const idx = cursor ? itemIds.indexOf(cursor) : -1
        const nextIdx = idx < 0
          ? (dir > 0 ? 0 : itemIds.length - 1)
          : Math.max(0, Math.min(itemIds.length - 1, idx + dir))
        const nextId = itemIds[nextIdx]
        if (nextId === cursor) return true   // already at the edge — swallow but no-op
        onSelectionChange([nextId])
        anchorRef.current = nextId
        onActivate?.(nextId)
        return true
      }
      return false
    },
    [selectedIds, onDelete, itemIds, onSelectionChange, onActivate],
  )

  return { isSelected, handleRowClick, handleKeyDown }
}
