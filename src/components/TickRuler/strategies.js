/**
 * Tier strategies for TickRuler. Each strategy emits a list of "layers"
 * that the engine renders. A layer describes one rhythm of ticks at one
 * spacing — the engine doesn't know whether it's drawing beats, bars,
 * seconds, or minutes.
 *
 * Layer descriptor:
 *   spacingUnit  — distance between ticks in the strategy's natural unit
 *                  (beats for 'bars' mode; seconds for 'time' mode)
 *   styleKey     — 'sub' | 'beat' | 'bar' (drives color + grid alpha)
 *   tickHeight   — pixels from the bottom of the ruler to the tick top
 *   isMajor      — true: full-height tick that owns the visible label
 *   skipModulo   — drop ticks where (i % skipModulo === 0); used to avoid
 *                  drawing on top of a coarser layer
 *   label        — function(unit) → string, or null
 *   labelStyle   — 'major' | 'minor'
 */

const TARGET_MAJOR_PX = 60;

export function barsLayers(state) {
    const { zoom: ppb, beatsPerBar } = state;
    const ppbar = ppb * beatsPerBar;
    let barGroup = 1;
    while (ppbar * barGroup < TARGET_MAJOR_PX) barGroup *= 2;
    if (barGroup > 4096) barGroup = 4096;

    let subBarGroup = 0;
    if (barGroup >= 8) subBarGroup = barGroup / 8;
    else if (barGroup >= 2) subBarGroup = 1;

    const showSixteenths = barGroup === 1 && ppb / 4 >= 6;
    const showEighths = barGroup === 1 && !showSixteenths && ppb / 2 >= 9;
    const showBeats = barGroup === 1 && ppb >= 22;
    const labelBeats = barGroup === 1 && ppb >= 70;

    const layers = [];

    if (showSixteenths) {
        layers.push({ spacingUnit: 0.25, styleKey: "sub", tickHeight: 5, skipModulo: 4 });
    } else if (showEighths) {
        layers.push({ spacingUnit: 0.5, styleKey: "sub", tickHeight: 6, skipModulo: 2 });
    }

    if (showBeats) {
        layers.push({
            spacingUnit: 1,
            styleKey: "beat",
            tickHeight: 11,
            skipModulo: beatsPerBar,
            label: labelBeats
                ? (b) => `${Math.floor(b / beatsPerBar) + 1}.${(b % beatsPerBar) + 1}`
                : null,
            labelStyle: "minor",
        });
    }

    if (subBarGroup > 0) {
        layers.push({
            spacingUnit: subBarGroup * beatsPerBar,
            styleKey: "beat",
            tickHeight: 14,
            skipModulo: barGroup / subBarGroup,
        });
    }

    layers.push({
        spacingUnit: barGroup * beatsPerBar,
        styleKey: "bar",
        isMajor: true,
        label: (b) => String(Math.floor(b / beatsPerBar) + 1),
        labelStyle: "major",
    });

    return layers;
}

const TIME_TIERS = [
    [0.001, 0.0002],
    [0.002, 0.0005],
    [0.005, 0.001],
    [0.01, 0.002],
    [0.02, 0.005],
    [0.05, 0.01],
    [0.1, 0.02],
    [0.2, 0.05],
    [0.5, 0.1],
    [1, 0.2],
    [2, 0.5],
    [5, 1],
    [10, 2],
    [15, 5],
    [30, 10],
    [60, 15],
    [120, 30],
    [300, 60],
    [600, 120],
    [1800, 300],
    [3600, 600],
    [7200, 1800],
    [21600, 3600],
    [43200, 7200],
];

export function timeLayers(state) {
    const pps = state.zoom;
    let tier = TIME_TIERS[TIME_TIERS.length - 1];
    for (const t of TIME_TIERS) {
        if (t[0] * pps >= TARGET_MAJOR_PX) {
            tier = t;
            break;
        }
    }
    const [major, sub] = tier;
    const ratio = Math.round(major / sub);

    const layers = [];
    if (sub * pps >= 6) {
        layers.push({
            spacingUnit: sub,
            styleKey: "sub",
            tickHeight: 7,
            skipModulo: ratio,
        });
    }
    layers.push({
        spacingUnit: major,
        styleKey: "bar",
        isMajor: true,
        label: (sec) => formatTimeLabel(sec, major),
        labelStyle: "major",
    });
    return layers;
}

export function chooseLayers(state) {
    return state.mode === "time" ? timeLayers(state) : barsLayers(state);
}

/** Format a time tick label. Precision adapts to the major spacing. */
export function formatTimeLabel(seconds, major) {
    const total = Math.max(0, seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total - h * 3600 - m * 60;
    const decimals = major < 0.01 ? 3 : major < 0.1 ? 2 : major < 1 ? 1 : 0;
    const sStr =
        decimals > 0
            ? s.toFixed(decimals).padStart(3 + decimals, "0")
            : String(Math.round(s)).padStart(2, "0");
    if (h > 0 || major >= 3600) return `${h}:${String(m).padStart(2, "0")}:${sStr}`;
    return `${m}:${sStr}`;
}

/** Bar.beat.sixteenth display for transport readout (bars mode). */
export function formatBBT(beats, beatsPerBar) {
    const b = Math.max(0, beats);
    const bar = Math.floor(b / beatsPerBar);
    const beatInBar = Math.floor(b - bar * beatsPerBar);
    const frac = b - bar * beatsPerBar - beatInBar;
    const sixteenth = Math.floor(frac * 4);
    return `${bar + 1}.${beatInBar + 1}.${sixteenth + 1}`;
}

/** HH:MM:SS.mmm display for transport readout. */
export function formatHMS(seconds) {
    const total = Math.max(0, seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total - h * 3600 - m * 60;
    return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}
