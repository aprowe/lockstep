import { useEffect, useState } from "react";
import { useAppSelector } from "../store/hooks";
import { getThumbnailQueueStats, type QueueStats } from "../api/thumbnails";
import "./ThumbnailQueueDebug.css";

interface Props {
    onClose: () => void;
}

export default function ThumbnailQueueDebug({ onClose }: Props) {
    const fileHash = useAppSelector((s) => s.video.video?.fileHash);
    const [stats, setStats] = useState<QueueStats | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!fileHash) return;
        let cancelled = false;
        const poll = async () => {
            try {
                const s = await getThumbnailQueueStats(fileHash);
                if (!cancelled) {
                    setStats(s);
                    setError(null);
                }
            } catch (e) {
                if (!cancelled) setError(String(e));
            }
        };
        poll();
        const id = setInterval(poll, 500);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [fileHash]);

    return (
        <div className="thumb-debug">
            <div className="thumb-debug__header">
                <span className="thumb-debug__title">Thumb Queue</span>
                <button
                    type="button"
                    className="thumb-debug__close"
                    onClick={onClose}
                    title="Close"
                >
                    ×
                </button>
            </div>
            {!fileHash ? (
                <div className="thumb-debug__empty">no video loaded</div>
            ) : error ? (
                <div className="thumb-debug__empty">error: {error}</div>
            ) : !stats ? (
                <div className="thumb-debug__empty">no data for this video yet</div>
            ) : (
                <>
                    <div className="thumb-debug__summary">
                        <div>
                            <span>workers</span>
                            <b>{stats.workers_running}</b>
                        </div>
                        <div>
                            <span>ready</span>
                            <b>
                                {stats.total_ready}/{stats.max_cached_frames}
                            </b>
                        </div>
                        <div>
                            <span>in-flight</span>
                            <b>{stats.total_in_flight}</b>
                        </div>
                        <div>
                            <span>max frame</span>
                            <b>{stats.max_frame}</b>
                        </div>
                    </div>
                    <table className="thumb-debug__table">
                        <thead>
                            <tr>
                                <th>tier</th>
                                <th>total</th>
                                <th>pending</th>
                                <th>flight</th>
                                <th>ready</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.tiers.map((t) => (
                                <tr
                                    key={t.name}
                                    className={t.total === 0 ? "thumb-debug__row--empty" : ""}
                                >
                                    <td>{t.name}</td>
                                    <td>{t.total}</td>
                                    <td>{t.pending}</td>
                                    <td>{t.in_flight}</td>
                                    <td>{t.ready}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    );
}
