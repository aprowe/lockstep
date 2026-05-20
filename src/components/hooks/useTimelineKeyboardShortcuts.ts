import { useEffect } from "react";
import { useAppDispatch } from "../../store/hooks";
import { removeAnchors } from "../../store/slices/warpSlice";
import { undo as undoAction, redo as redoAction } from "../../store/slices/historySlice";

/**
 * Timeline keyboard shortcuts:
 *  - Delete / Backspace: remove selected anchors
 *  - Ctrl-Z / Meta-Z: undo
 *  - Ctrl-Y / Ctrl-Shift-Z / Meta-Shift-Z: redo
 *
 * Shortcuts are suppressed when focus is inside a text input.
 */
export function useTimelineKeyboardShortcuts(selectedIds: ReadonlySet<number>) {
    const dispatch = useAppDispatch();
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const active = document.activeElement as HTMLElement | null;
            const inInput =
                !!active &&
                (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.tagName === "SELECT" ||
                    active.isContentEditable);
            if (inInput) return;
            if (e.key === "Delete" || e.key === "Backspace") {
                const ids = [...selectedIds];
                if (ids.length > 0) {
                    e.preventDefault();
                    dispatch(removeAnchors(ids));
                }
                return;
            }
            if (!e.ctrlKey && !e.metaKey) return;
            if (e.key === "z" && !e.shiftKey) {
                e.preventDefault();
                dispatch(undoAction());
            }
            if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
                e.preventDefault();
                dispatch(redoAction());
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selectedIds, dispatch]);
}
