import { useEffect, useRef } from "react";
import "./ContextMenu.css";

// ── Types ────────────────────────────────────────────────────────────────────

export type ContextMenuItem =
    | { label: string; action: () => void; disabled?: boolean; danger?: boolean }
    | { separator: true };

export interface ContextMenuState {
    x: number;
    y: number;
    items: ContextMenuItem[];
    title?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

interface ContextMenuProps {
    menu: ContextMenuState;
    onClose: () => void;
}

export default function ContextMenu({ menu, onClose }: ContextMenuProps) {
    const ref = useRef<HTMLDivElement>(null);

    // Close on click-outside or Escape
    useEffect(() => {
        const handleDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        // Use capture so we see clicks before anything else
        document.addEventListener("mousedown", handleDown, true);
        document.addEventListener("keydown", handleKey, true);
        return () => {
            document.removeEventListener("mousedown", handleDown, true);
            document.removeEventListener("keydown", handleKey, true);
        };
    }, [onClose]);

    // Clamp to viewport after render
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (rect.right > vw) el.style.left = `${menu.x - rect.width}px`;
        if (rect.bottom > vh) el.style.top = `${menu.y - rect.height}px`;
    });

    return (
        <div
            ref={ref}
            className="ctx-menu"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {menu.title && <div className="ctx-menu__title">{menu.title}</div>}
            {menu.items.map((item, i) => {
                if ("separator" in item) {
                    return <div key={i} className="ctx-menu__sep" />;
                }
                return (
                    <button
                        key={i}
                        className={`ctx-menu__item${item.danger ? " ctx-menu__item--danger" : ""}`}
                        disabled={item.disabled}
                        // Run on click (not mousedown) so the natural mousedown→mouseup→
                        // click sequence completes against the menu button before the
                        // action unmounts the menu. Otherwise mouseup + click land on
                        // whatever sits *underneath* the menu, which can steal focus
                        // from a freshly-mounted input (e.g. inline rename) — the input
                        // immediately blurs and commits as a no-op.
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!item.disabled) {
                                item.action();
                                onClose();
                            }
                        }}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}
