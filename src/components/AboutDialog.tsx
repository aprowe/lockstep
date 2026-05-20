import { useEffect } from "react";
import packageJson from "../../package.json";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LockstepMark } from "./LockstepMark";
import "./AboutDialog.css";

const REPO_URL = "https://github.com/aprowe/lockstep";

async function openExternal(url: string) {
    // openUrl invokes Tauri; in browser/test contexts (no __TAURI_INTERNALS__) it throws,
    // and we fall back to a regular window.open.
    try {
        await openUrl(url);
    } catch {
        window.open(url, "_blank", "noopener,noreferrer");
    }
}

interface AboutDialogProps {
    open: boolean;
    onClose: () => void;
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
    useEffect(() => {
        if (!open) return;
        const h = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopImmediatePropagation();
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", h, true);
        return () => window.removeEventListener("keydown", h, true);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="about-overlay" onClick={onClose}>
            <div className="about-dialog" onClick={(e) => e.stopPropagation()}>
                <button
                    className="about-dialog__close"
                    onClick={onClose}
                    title="Close"
                    aria-label="Close"
                >
                    ✕
                </button>
                <div className="about-dialog__mark">
                    <LockstepMark size={64} />
                </div>
                <div className="about-dialog__name">Lockstep</div>
                <div className="about-dialog__version">Version {packageJson.version}</div>
                <div className="about-dialog__tag">BPM-warp video to music.</div>
                <a
                    className="about-dialog__link"
                    href={REPO_URL}
                    onClick={(e) => {
                        e.preventDefault();
                        openExternal(REPO_URL);
                    }}
                >
                    {REPO_URL.replace("https://", "")}
                </a>
            </div>
        </div>
    );
}
