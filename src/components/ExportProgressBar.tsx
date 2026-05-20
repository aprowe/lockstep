import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setExportOpen, resetExportProgress } from "../store/slices/uiSlice";
import "./ExportProgressBar.css";

/**
 * Compact export progress bar mounted in the top-right column. Shows when the
 * ExportDialog has been closed mid-run so users can still see and click back
 * into the in-flight warp job.
 */
export default function ExportProgressBar() {
    const dispatch = useAppDispatch();
    const ep = useAppSelector((s) => s.ui.exportProgress);
    const open = useAppSelector((s) => s.ui.exportOpen);

    // Only show when there's something worth showing and the dialog is hidden.
    if (open) return null;
    if (ep.status === "idle") return null;

    const total = Math.max(ep.totalJobs, 1);
    const pct = Math.max(0, Math.min(100, Math.round(((ep.jobIdx + ep.progress) / total) * 100)));

    const title =
        ep.totalJobs > 1 ? `${ep.label} (${ep.jobIdx + 1}/${ep.totalJobs})` : ep.label || "Export";

    return (
        <button
            className={`export-mini export-mini--${ep.status}`}
            onClick={() => dispatch(setExportOpen(true))}
            title="Open export dialog"
        >
            <div className="export-mini__head">
                <span className="export-mini__label" title={title}>
                    {title}
                </span>
                <span className="export-mini__pct">
                    {ep.status === "processing"
                        ? `${pct}%`
                        : ep.status === "done"
                          ? "Done"
                          : "Error"}
                </span>
                {ep.status !== "processing" && (
                    <span
                        className="export-mini__dismiss"
                        role="button"
                        aria-label="Dismiss"
                        onClick={(e) => {
                            e.stopPropagation();
                            dispatch(resetExportProgress());
                        }}
                    >
                        ✕
                    </span>
                )}
            </div>
            <div className="export-mini__bar">
                <div
                    className="export-mini__fill"
                    style={{ width: ep.status === "error" ? "100%" : `${pct}%` }}
                />
            </div>
            {ep.message && ep.status === "processing" && (
                <div className="export-mini__msg" title={ep.message}>
                    {ep.message}
                </div>
            )}
            {ep.error && ep.status === "error" && (
                <div className="export-mini__msg export-mini__msg--error" title={ep.error}>
                    {ep.error}
                </div>
            )}
        </button>
    );
}
