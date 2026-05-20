import { useSyncExternalStore, useState } from "react";
import { useAppSelector } from "../store/hooks";
import * as rec from "../utils/devThumbnailRecorder";
import "./DevRecorderPanel.css";

function useRecorderStats() {
    return useSyncExternalStore(rec.subscribe, rec.getStats);
}

export default function DevRecorderPanel() {
    const [saving, setSaving] = useState(false);
    const stats = useRecorderStats();
    const video = useAppSelector((s) => s.video.video);

    const handleStart = () => {
        if (!video) return;
        rec.startRecording(video.fps, video.fileHash, video.duration);
    };

    const handleSave = async () => {
        setSaving(true);
        await rec.saveRecording();
        setSaving(false);
    };

    const fmt = (ms: number) => (ms > 0 ? `${ms.toFixed(0)}ms` : "—");

    return (
        <div className="dev-rec">
            <div className="dev-rec__controls">
                <button
                    className={`dev-rec__btn dev-rec__btn--primary${stats.recording ? " dev-rec__btn--active" : ""}`}
                    onClick={handleStart}
                    disabled={stats.recording || !video}
                    title={!video ? "Load a video first" : undefined}
                >
                    {stats.recording ? "● Recording" : "▶ Start"}
                </button>
                <button
                    className="dev-rec__btn"
                    onClick={rec.stopRecording}
                    disabled={!stats.recording}
                >
                    ⏹ Stop
                </button>
                <button
                    className="dev-rec__btn"
                    onClick={handleSave}
                    disabled={saving || stats.priorityPushes === 0}
                >
                    {saving ? "…" : "💾 Save"}
                </button>
            </div>

            <div className="dev-rec__stats">
                <div className="dev-rec__row">
                    <span className="dev-rec__key">Priority pushes</span>
                    <span className="dev-rec__val">{stats.priorityPushes}</span>
                </div>
                <div className="dev-rec__row">
                    <span className="dev-rec__key">Thumbs generated</span>
                    <span className="dev-rec__val">{stats.thumbnailsDone}</span>
                </div>
            </div>

            {stats.thumbnailsDone > 0 && (
                <div className="dev-rec__stats dev-rec__stats--timing">
                    <div className="dev-rec__section-label">Generation time</div>
                    <div className="dev-rec__row">
                        <span className="dev-rec__key">avg</span>
                        <span className="dev-rec__val">{fmt(stats.avgMs)}</span>
                    </div>
                    <div className="dev-rec__row">
                        <span className="dev-rec__key">min</span>
                        <span className="dev-rec__val">{fmt(stats.minMs)}</span>
                    </div>
                    <div className="dev-rec__row">
                        <span className="dev-rec__key">p50</span>
                        <span className="dev-rec__val">{fmt(stats.p50Ms)}</span>
                    </div>
                    <div className="dev-rec__row">
                        <span className="dev-rec__key">p95</span>
                        <span className="dev-rec__val">{fmt(stats.p95Ms)}</span>
                    </div>
                    <div className="dev-rec__row">
                        <span className="dev-rec__key">max</span>
                        <span className="dev-rec__val">{fmt(stats.maxMs)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
