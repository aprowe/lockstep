/**
 * Passthrough stub — original middleware logic was removed; this file is
 * retained only so existing test imports continue to resolve.
 *
 * globals.lockMode is now set by buildGraphFromSlice directly from ui.lockMode
 * at every pipeline invocation, so no middleware behavior is needed.
 */

import type { Middleware } from '@reduxjs/toolkit'

export const globalLockModeMirrorMiddleware: Middleware = (_api) => (next) => (action) => {
  return next(action)
}
