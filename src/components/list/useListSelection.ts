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
        onDelete?.([...selectedIds])
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
      return false
    },
    [selectedIds, onDelete, itemIds, onSelectionChange],
  )

  return { isSelected, handleRowClick, handleKeyDown }
}
