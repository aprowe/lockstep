/**
 * Returns the latest target time strictly before the playhead, applying a
 * dead-zone so a target the playhead just rolled past is treated as "behind
 * but still current" and skipped.
 *
 * The dead-zone widens to 0.5s while playing — at typical playback speeds
 * the playhead races past markers within a few hundred ms, so without the
 * widened window the user would press Previous and land back on the marker
 * they just heard. When paused, a tiny window keeps single-frame nudges
 * stable without skipping over the nearest earlier target.
 */
const PLAYING_WINDOW = 0.5;
const PAUSED_WINDOW = 0.05;

export function findPreviousTarget(
    targets: number[],
    playhead: number,
    playing: boolean,
): number | undefined {
    const window = playing ? PLAYING_WINDOW : PAUSED_WINDOW;
    const cutoff = playhead - window;
    let best: number | undefined;
    for (const t of targets) {
        if (t < cutoff && (best === undefined || t > best)) best = t;
    }
    return best;
}
