import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./WindowControls.css";

function hasTauriRuntime(): boolean {
    if (typeof window === "undefined") return false;
    const internals = (
        window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: unknown } } }
    ).__TAURI_INTERNALS__;
    return !!internals?.metadata?.currentWindow;
}

const hasTauri = hasTauriRuntime();

export default function WindowControls() {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        if (!hasTauri) return;
        const w = getCurrentWindow();
        let unlisten: (() => void) | undefined;
        w.isMaximized()
            .then(setMaximized)
            .catch(() => {});
        w.onResized(() => {
            w.isMaximized()
                .then(setMaximized)
                .catch(() => {});
        })
            .then((fn) => {
                unlisten = fn;
            })
            .catch(() => {});
        return () => {
            unlisten?.();
        };
    }, []);

    const w = hasTauri ? getCurrentWindow() : null;

    return (
        <div className="winctl">
            <button
                className="winctl__btn"
                onClick={() => w?.minimize()}
                title="Minimize"
                aria-label="Minimize"
            >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
                </svg>
            </button>

            <button
                className="winctl__btn"
                onClick={() => w?.toggleMaximize()}
                title={maximized ? "Restore" : "Maximize"}
                aria-label={maximized ? "Restore" : "Maximize"}
            >
                {maximized ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                        <rect
                            x="1.5"
                            y="2.5"
                            width="6"
                            height="6"
                            stroke="currentColor"
                            strokeWidth="1"
                            fill="none"
                        />
                        <path
                            d="M3 2.5 V1 H8.5 V6.5 H7"
                            stroke="currentColor"
                            strokeWidth="1"
                            fill="none"
                        />
                    </svg>
                ) : (
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                        <rect
                            x="1"
                            y="1"
                            width="8"
                            height="8"
                            stroke="currentColor"
                            strokeWidth="1"
                            fill="none"
                        />
                    </svg>
                )}
            </button>

            <button
                className="winctl__btn winctl__btn--close"
                onClick={() => w?.close()}
                title="Close"
                aria-label="Close"
            >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <line
                        x1="1.5"
                        y1="1.5"
                        x2="8.5"
                        y2="8.5"
                        stroke="currentColor"
                        strokeWidth="1"
                    />
                    <line
                        x1="8.5"
                        y1="1.5"
                        x2="1.5"
                        y2="8.5"
                        stroke="currentColor"
                        strokeWidth="1"
                    />
                </svg>
            </button>
        </div>
    );
}
