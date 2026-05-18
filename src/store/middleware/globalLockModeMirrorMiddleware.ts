/**
 * globalLockModeMirrorMiddleware deleted.
 *
 * globals.lockMode is now set by buildGraphFromSlice directly from ui.lockMode
 * at every pipeline invocation. No middleware is needed.
 *
 * This file is a stub retained for backward compatibility with test imports.
 */

import type { Middleware } from '@reduxjs/toolkit'

export const globalLockModeMirrorMiddleware: Middleware = (_api) => (next) => (action) => {
  return next(action)
}
