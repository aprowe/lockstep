import { createContext, useContext, type RefObject } from 'react'
import type { VideoPlayerHandle } from '../components/VideoPlayer'
import type { ContextMenuState } from '../components/ContextMenu'

/**
 * Bridges App-level imperative APIs (player ref, dialog state) into panels
 * rendered by dockview. Dockview re-mounts panel components on layout changes;
 * passing these via context keeps a single stable identity instead of forcing
 * a layout rebuild every time a callback closure changes.
 */
export interface DockBridge {
  /** Seek the player to a given time in seconds. */
  seek: (time: number) => void
  /** Open / close the Export dialog. */
  setExportOpen: (open: boolean) => void
  /** Request inline-rename for a region in the clips sidebar. */
  setPendingRenameId: (id: string | null) => void
  /** Read the current pending-rename id (cleared by the panel after consuming). */
  pendingRenameId: string | null
  /** Mutable ref to the (single) VideoPlayer instance. CenterColumn sets it
   *  via <VideoPlayer ref>; everyone else reads .current?.seek() etc. */
  playerRef: RefObject<VideoPlayerHandle | null>
  /** Open the floating clip context menu (shown at App level). */
  setClipContextMenu: (menu: ContextMenuState | null) => void
}

const DockBridgeContext = createContext<DockBridge | null>(null)

export const DockBridgeProvider = DockBridgeContext.Provider

export function useDockBridge(): DockBridge {
  const ctx = useContext(DockBridgeContext)
  if (!ctx) throw new Error('useDockBridge requires DockBridgeProvider')
  return ctx
}
