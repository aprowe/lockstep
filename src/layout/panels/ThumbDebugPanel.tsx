import { useEffect, useState } from "react";
import { useAppSelector } from "../../store/hooks";
import { getThumbnailStats, type ThumbnailStats } from "../../api/thumbnails";
import "./ThumbDebugPanel.css";

const POLL_MS = 500;

export default function ThumbDebugPanel() {
    const fileHash = useAppSelector((s) => s.video.video?.fileHash);
    const [stats, setStats] = useState<ThumbnailStats | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!fileHash) {
            setStats(null);
            return;
        }
        let cancelled = false;
        const poll = async () => {
            try {
                const s = await getThumbnailStats(fileHash);
                if (!cancelled) {
                    setStats(s);
                    setError(null);
                }
            } catch (e) {
                if (!cancelled) setError(String(e));
            }
        };
        poll();
        const id = setInterval(poll, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [fileHash]);

    if (!fileHash) return <div className="thumb-dbg__empty">no video loaded</div>;
    if (error) return <div className="thumb-dbg__empty">error: {error}</div>;
    if (!stats) return <div className="thumb-dbg__empty">no data yet</div>;

    const dynPct = stats.max_dynamic > 0
        ? Math.min(100, Math.round(((stats.ready_dynamic_only + stats.ready_both) / stats.max_dynamic) * 100))
        : 0;

    return (
        <div className="thumb-dbg">
            <section className="thumb-dbg__section">
                <h4>wants</h4>
                <Row label="static set" value={stats.static_set} />
                <Row label="dynamic set" value={`${stats.dynamic_set} / ${stats.max_dynamic}`} />
                <Row label="pending" value={stats.pending} />
                <Row label="in-flight" value={stats.in_flight} />
                <Row label="workers" value={`${stats.active_workers} / 2`} />
            </section>

            <section className="thumb-dbg__section">
                <h4>on-disk ({stats.ready_total})</h4>
                <Row label="static only" value={stats.ready_static_only} />
                <Row label="dynamic only" value={stats.ready_dynamic_only} />
                <Row label="both retainers" value={stats.ready_both} />
                <Row
                    label="dynamic unwanted"
                    value={stats.ready_dynamic_unwanted}
                    hint="LRU-eligible — leftovers from prior wants or bonus warming"
                />
                <div className="thumb-dbg__bar">
                    <div className="thumb-dbg__bar-fill" style={{ width: `${dynPct}%` }} />
                    <span>{dynPct}% of dynamic cap</span>
                </div>
            </section>

            <section className="thumb-dbg__section">
                <h4>video</h4>
                <Row label="thumb width" value={`${stats.thumb_width}px`} />
                <Row
                    label="keyframes"
                    value={stats.keyframes_probed ? stats.keyframes_count : "probing…"}
                />
                <Row label="generation" value={stats.generation} />
            </section>

            <section className="thumb-dbg__section">
                <h4>health</h4>
                <Row label="lifetime jobs" value={stats.lifetime_jobs} />
                <Row
                    label="failures"
                    value={stats.lifetime_failures}
                    hint="ffmpeg jobs that exited non-zero or produced no usable outputs"
                />
                <Row
                    label="abandoned frames"
                    value={stats.abandoned_frames}
                    hint="wanted frames that hit the retry cap and were dropped"
                />
                {stats.last_error ? (
                    <div className="thumb-dbg__error" title={stats.last_error}>
                        {stats.last_error}
                    </div>
                ) : null}
            </section>
        </div>
    );
}

function Row({
    label,
    value,
    hint,
}: {
    label: string;
    value: string | number;
    hint?: string;
}) {
    return (
        <div className="thumb-dbg__row" title={hint}>
            <span className="thumb-dbg__label">{label}</span>
            <span className="thumb-dbg__value">{value}</span>
        </div>
    );
}
