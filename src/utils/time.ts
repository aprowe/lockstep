export function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(2).padStart(5, "0");
    return m > 0 ? `${m}:${sec}` : `${sec}s`;
}

/** Convert seconds to frame count, rounded to nearest integer */
export function secondsToFrames(seconds: number, fps: number): number {
    if (fps <= 0) return 0;
    return Math.round(seconds * fps);
}

/** Format a frame count like "75f" */
export function formatFrames(seconds: number, fps: number): string {
    return `${secondsToFrames(seconds, fps)}f`;
}
