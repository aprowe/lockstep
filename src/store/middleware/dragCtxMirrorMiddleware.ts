/**
 * Phase 4c: dragCtxMirrorMiddleware deleted.
 *
 * Snap state is dispatched directly to dragCtxSlice by WarpView
 * (setSnapInstall / clearSnapInstall).
 * No middleware is needed.
 *
 * This file is a stub retained for backward compatibility with test imports.
 */

import type { Middleware } from '@reduxjs/toolkit'

export const dragCtxMirrorMiddleware: Middleware = (_api) => (next) => (action) => {
  return next(action)
}
