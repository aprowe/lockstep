/**
 * Passthrough middleware retained as a stable import point for tests.
 *
 * `globals.lockMode` is set by `buildGraphFromSlice` directly from
 * `ui.lockMode` on every pipeline invocation, so no mirror logic is needed.
 */

import type { Middleware } from "@reduxjs/toolkit";

export const globalLockModeMirrorMiddleware: Middleware = (_api) => (next) => (action) => {
    return next(action);
};
