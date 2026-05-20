import type { Anchor, Region } from "../../types";
import { effectiveBeatBounds } from "./effectiveBounds";

export interface LinkingEventInput {
    region: Region;
    edge: "in" | "out";
    /** Whether this is an input-side (clipin) or output-side (clipout) linking event.
     *  Input-side: edge is linked to an input anchor's time; commit writes inBeatTime
     *  (or outBeatTime) from the paired BEAT anchor's beat time.
     *  Output-side: edge is linked to a beat anchor's time; commit writes inBeatTime
     *  (or outBeatTime) from the BEAT anchor's beat time directly. */
    side: "input" | "output";
    /** The paired BEAT anchor whose beat time becomes the new inBeatTime/outBeatTime. */
    beatAnchor: Anchor;
    /** Current input (orig) anchors — used to compute the effective beat-space
     *  bound for the NON-linked edge (accounts for input-anchor conform). */
    origAnchors?: readonly Anchor[];
    /** Current beat anchors — paired with origAnchors above. */
    beatAnchors?: readonly Anchor[];
}

export interface LinkingEventResult {
    inBeatTime: number;
    outBeatTime: number;
    lockedBeats: number;
    /** Echoed unchanged — included so callers can pass result straight to a region update. */
    bpm: number;
}

/**
 * Compute the committed region values for a linking-event commit (design §3.2,
 * §5a/§5b). Always behaves like lock='bpm' — bpm stays, lockedBeats absorbs.
 * Caller is responsible for actually writing the values to the slice.
 *
 * NOTE: `side` is informational only and does not affect the math. Both
 * input-side (§5a) and output-side (§5b) commits write `beatAnchor.time` to
 * inBeatTime or outBeatTime — the only difference is how the caller determined
 * which anchor is the "beat anchor". Keeping `side` on the input makes call
 * sites explicit about which coincidence triggered the event.
 */
export function commitLinkingEvent(input: LinkingEventInput): LinkingEventResult {
    const { region, edge, beatAnchor, origAnchors = [], beatAnchors = [] } = input;

    // Resolve current beat-space bounds using effective bounds (accounts for
    // input-anchor conform when the region is default-linked).
    const { inBeatTime: currentInBeatTime, outBeatTime: currentOutBeatTime } = effectiveBeatBounds(
        region,
        origAnchors,
        beatAnchors,
    );

    // Override the edge that was linked; the other edge is preserved as-is.
    const newInBeatTime = edge === "in" ? beatAnchor.time : currentInBeatTime;
    const newOutBeatTime = edge === "out" ? beatAnchor.time : currentOutBeatTime;

    const clipoutLength = newOutBeatTime - newInBeatTime;

    // Always lock='bpm' semantics: BPM stays, lockedBeats absorbs the change.
    const lockedBeats = (clipoutLength * region.bpm) / 60;

    return {
        inBeatTime: newInBeatTime,
        outBeatTime: newOutBeatTime,
        lockedBeats,
        bpm: region.bpm,
    };
}
