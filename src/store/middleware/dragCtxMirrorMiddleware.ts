/**
 * Passthrough stub — original middleware logic was removed; this file is
 * retained only so existing test imports continue to resolve.
 *
 * Snap state is now dispatched directly to dragCtxSlice by WarpView
 * (setSnapInstall / clearSnapInstall), so no middleware behavior is needed.
 */

import type { Middleware } from '@reduxjs/toolkit'

export const dragCtxMirrorMiddleware: Middleware = (_api) => (next) => (action) => {
  return next(action)
}
