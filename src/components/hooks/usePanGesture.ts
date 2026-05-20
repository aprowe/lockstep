import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { View } from "../../types";

/**
 * Middle-mouse or Shift+left-drag panning for the timeline container.
 *
 * Attaches pointer event listeners to the element referenced by `containerRef`.
 * Calls `onViewChange` with the panned view and updates `setShiftHeld`/`setPanning`.
 */
export function usePanGesture(
    containerRef: RefObject<HTMLElement | null>,
    viewRef: RefObject<View>,
    onViewChange: (v: View) => void,
    setShiftHeld: (v: boolean) => void,
    setPanning: (v: boolean) => void,
) {
    const onViewChangeRef = useRef(onViewChange);
    onViewChangeRef.current = onViewChange;
    const panGesture = useRef<{ lastX: number; width: number } | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Shift") setShiftHeld(true);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === "Shift") {
                setShiftHeld(false);
                panGesture.current = null;
                setPanning(false);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        const onDown = (e: PointerEvent) => {
            if (e.button === 1 || (e.shiftKey && e.button === 0)) {
                /* pan */
            } else return;
            e.stopPropagation();
            const rect = el.getBoundingClientRect();
            el.setPointerCapture(e.pointerId);
            panGesture.current = { lastX: e.clientX, width: rect.width };
            setPanning(true);
        };
        const onMove = (e: PointerEvent) => {
            const g = panGesture.current;
            if (!g || !e.buttons) return;
            const v = viewRef.current!;
            const span = v.end - v.start;
            const delta = ((g.lastX - e.clientX) / g.width) * span;
            onViewChangeRef.current({ start: v.start + delta, end: v.end + delta });
            panGesture.current = { ...g, lastX: e.clientX };
        };
        const onUp = () => {
            panGesture.current = null;
            setPanning(false);
        };

        el.addEventListener("pointerdown", onDown, { capture: true });
        el.addEventListener("pointermove", onMove, { capture: true });
        el.addEventListener("pointerup", onUp, { capture: true });
        el.addEventListener("pointercancel", onUp, { capture: true });
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            el.removeEventListener("pointerdown", onDown, { capture: true });
            el.removeEventListener("pointermove", onMove, { capture: true });
            el.removeEventListener("pointerup", onUp, { capture: true });
            el.removeEventListener("pointercancel", onUp, { capture: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}
