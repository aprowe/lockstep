import type { View } from "../types";
import { clampView as baseClampView } from "../utils/view";

export const clampView = baseClampView;

/** Compute the next view after a wheel zoom around `cursorX`. */
export function wheelZoom(
    view: View,
    cursorX: number,
    canvasWidth: number,
    deltaY: number,
    maxDuration: number,
): View {
    const factor = Math.exp(-deltaY * 0.002);
    const unitAt = view.start + (cursorX / canvasWidth) * (view.end - view.start);
    const span = view.end - view.start;
    const newSpan = Math.max(0.1, Math.min(maxDuration * 2, span / factor));
    const newStart = unitAt - (cursorX / canvasWidth) * newSpan;
    return clampView(newStart, newStart + newSpan, maxDuration);
}

/** Compute the next view after a wheel pan (no zoom modifier). */
export function wheelPan(
    view: View,
    canvasWidth: number,
    deltaX: number,
    deltaY: number,
    shiftKey: boolean,
    maxDuration: number,
): View {
    const span = view.end - view.start;
    const px = shiftKey && deltaX === 0 ? deltaY : deltaX !== 0 ? deltaX : deltaY;
    const delta = (px / canvasWidth) * span;
    return clampView(view.start + delta, view.end + delta, maxDuration);
}

/** Compute the next view from a minimap click at `clientXInMinimap`. */
export function minimapRecenter(
    view: View,
    clientXInMinimap: number,
    minimapWidth: number,
    maxDuration: number,
): View {
    const t = (clientXInMinimap / minimapWidth) * maxDuration;
    const span = view.end - view.start;
    return clampView(t - span / 2, t + span / 2, maxDuration);
}

/** Compute the next view for a click-and-drag pan. */
export function dragPan(
    startView: View,
    canvasWidth: number,
    pxDelta: number,
    maxDuration: number,
): View {
    const span = startView.end - startView.start;
    const dx = (pxDelta / canvasWidth) * span;
    return clampView(startView.start - dx, startView.end - dx, maxDuration);
}
