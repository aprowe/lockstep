//! Stage 1 — Time map construction (pure).
//!
//! Given raw orig/beat anchor arrays and clip bounds, produces a list of
//! `(t_src, t_out)` control points that downstream stages walk to plan segments
//! and drive warp-aware RIFE. This stage performs no I/O and is fully testable
//! with table-driven unit tests.

use crate::pchip::smooth_time_map;

/// A monotonic piecewise-linear (or PCHIP-densified) map from source time to
/// output time. Sorted ascending by `.0`; `.1` is also non-decreasing.
pub type TimeMap = Vec<(f64, f64)>;

/// Piecewise-linear map: `orig_time → output_time`. Inserts sentinel head/tail
/// points only when `clip_start` / `clip_end` sit strictly outside the anchor
/// range, to avoid the catastrophic first-segment stretch that happens when the
/// clip boundary equals the first/last anchor.
pub fn direct_time_map(
    orig_times: &[f64],
    beat_times: &[f64],
    clip_start: f64,
    clip_end: f64,
) -> TimeMap {
    let mut pairs: Vec<(f64, f64)> = orig_times
        .iter()
        .zip(beat_times.iter())
        .map(|(&o, &b)| (o, b))
        .collect();
    pairs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    let mut control_points: TimeMap = Vec::new();

    // Head: only insert a sentinel at clip_start if it sits meaningfully before
    // the first anchor. Extrapolate at 1:1 from the first anchor so the
    // pre-anchor portion of the clip doesn't get fictitiously stretched. When
    // clip_start ≈ orig[0] (common: region inPoint == first anchor), the first
    // anchor itself becomes the starting control point.
    match pairs.first() {
        Some(&(first_orig, first_beat)) if first_orig > clip_start + 1e-6 => {
            let head_out = first_beat - (first_orig - clip_start);
            control_points.push((clip_start, head_out));
        }
        None => control_points.push((clip_start, 0.0)),
        _ => {}
    }

    for (orig_t, beat_t) in &pairs {
        if control_points.is_empty() || *orig_t > control_points.last().unwrap().0 + 1e-6 {
            control_points.push((*orig_t, *beat_t));
        }
    }

    let (last_orig, last_beat) = *control_points.last().unwrap();
    if clip_end > last_orig + 1e-6 {
        let tail_out = last_beat + (clip_end - last_orig);
        control_points.push((clip_end, tail_out));
    }

    control_points
}

/// Build the full time map: piecewise-linear direct map, optionally densified
/// with PCHIP so speed ratios transition smoothly between anchor boundaries.
pub fn build_time_map(
    orig_times: &[f64],
    beat_times: &[f64],
    clip_start: f64,
    clip_end: f64,
    smooth: bool,
) -> TimeMap {
    let linear = direct_time_map(orig_times, beat_times, clip_start, clip_end);
    if smooth {
        smooth_time_map(&linear, 0.5)
    } else {
        linear
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_start_equals_first_anchor_no_head_sentinel() {
        let map = direct_time_map(&[0.0, 2.0], &[0.0, 3.0], 0.0, 2.0);
        assert_eq!(map, vec![(0.0, 0.0), (2.0, 3.0)]);
    }

    #[test]
    fn clip_start_before_first_anchor_adds_head_sentinel_at_one_to_one() {
        let map = direct_time_map(&[1.0, 2.0], &[5.0, 6.0], 0.0, 2.0);
        // head: (0.0, 5.0 - (1.0 - 0.0)) = (0.0, 4.0)
        assert_eq!(map, vec![(0.0, 4.0), (1.0, 5.0), (2.0, 6.0)]);
    }

    #[test]
    fn clip_end_past_last_anchor_adds_tail_sentinel_at_one_to_one() {
        let map = direct_time_map(&[0.0, 1.0], &[0.0, 2.0], 0.0, 3.0);
        // tail: (3.0, 2.0 + (3.0 - 1.0)) = (3.0, 4.0)
        assert_eq!(map, vec![(0.0, 0.0), (1.0, 2.0), (3.0, 4.0)]);
    }

    #[test]
    fn unsorted_anchors_are_sorted_by_t_src() {
        let map = direct_time_map(&[2.0, 0.0, 1.0], &[5.0, 0.0, 2.0], 0.0, 2.0);
        assert_eq!(map, vec![(0.0, 0.0), (1.0, 2.0), (2.0, 5.0)]);
    }

    #[test]
    fn duplicate_orig_times_are_deduped() {
        let map = direct_time_map(&[0.0, 1.0, 1.0, 2.0], &[0.0, 2.0, 2.5, 5.0], 0.0, 2.0);
        // Near-duplicate at t_src=1.0 is dropped; first occurrence wins.
        assert_eq!(map, vec![(0.0, 0.0), (1.0, 2.0), (2.0, 5.0)]);
    }

    #[test]
    fn no_smooth_returns_raw_linear_map() {
        let map = build_time_map(&[0.0, 1.0, 2.0], &[0.0, 2.0, 3.0], 0.0, 2.0, false);
        assert_eq!(map, vec![(0.0, 0.0), (1.0, 2.0), (2.0, 3.0)]);
    }

    #[test]
    fn smoothed_preserves_original_control_points() {
        let map = build_time_map(&[0.0, 2.0, 5.0, 8.0], &[0.0, 2.5, 4.0, 9.0], 0.0, 8.0, true);
        for &pt in &[(0.0, 0.0), (2.0, 2.5), (5.0, 4.0), (8.0, 9.0)] {
            assert!(map.contains(&pt), "smoothed map missing original point {pt:?}");
        }
    }

    // ── Boundary anchor injection: output-duration × BPM checks ──────────────
    //
    // The frontend always injects (clipIn → inBeatTime) and (clipOut → outBeatTime)
    // as boundary anchors before sending to the Rust pipeline. These four cases
    // verify that the time map's output span equals outBeatTime − inBeatTime (to
    // floating-point precision), and that the implied beat count matches BPM × span / 60.
    //
    // "High degree of tolerance" here means < 1 µs error (pure arithmetic, no I/O).

    const BPM_120: f64 = 120.0;

    fn output_span(map: &TimeMap) -> f64 {
        map.last().unwrap().1 - map.first().unwrap().1
    }
    fn beats_at_120(secs: f64) -> f64 {
        secs * BPM_120 / 60.0
    }

    /// Case 1 — Identity: inBeatTime == inPoint, outBeatTime == outPoint.
    /// The clip runs at 1:1 speed; output duration equals source clip duration.
    #[test]
    fn boundary_identity_output_matches_source_duration() {
        let in_beat = 0.0_f64;
        let out_beat = 10.0_f64;
        let map = direct_time_map(&[in_beat, out_beat], &[in_beat, out_beat], in_beat, out_beat);
        let span = output_span(&map);
        let expected = out_beat - in_beat; // 10.0 s
        assert!(
            (span - expected).abs() < 1e-6,
            "identity: expected {expected}s output, got {span}",
        );
        let expected_beats = beats_at_120(expected); // 20 beats
        assert!(
            (beats_at_120(span) - expected_beats).abs() < 1e-6,
            "identity: expected {expected_beats} beats @ {BPM_120}bpm, got {}",
            beats_at_120(span),
        );
    }

    /// Case 2 — No real markers, clip is warped via boundary anchors only.
    /// Source 0–1 s stretched to 2 s (0.5× speed); both anchors are boundary injections.
    #[test]
    fn boundary_no_markers_clip_warp_output_matches_beat_span() {
        let clip_in = 0.0_f64;
        let clip_out = 1.0_f64;
        let in_beat = 0.0_f64;
        let out_beat = 2.0_f64; // 2 s = 4 beats @ 120 bpm
        let map = direct_time_map(&[clip_in, clip_out], &[in_beat, out_beat], clip_in, clip_out);
        let span = output_span(&map);
        let expected = out_beat - in_beat;
        assert!(
            (span - expected).abs() < 1e-6,
            "no-markers warp: expected {expected}s output, got {span}",
        );
        let expected_beats = beats_at_120(expected); // 4 beats
        assert!(
            (beats_at_120(span) - expected_beats).abs() < 1e-6,
            "no-markers warp: expected {expected_beats} beats, got {}",
            beats_at_120(span),
        );
    }

    /// Case 3 — Real markers covering the full clip, no artificial clip restriction.
    /// Three anchors produce variable stretch; total beat span is outBeatTime − inBeatTime.
    #[test]
    fn boundary_markers_full_clip_output_matches_beat_span() {
        // Source 0–2 s; marker at 1 s maps to 1.5 s (first half slower, second faster).
        // Boundary anchors at the clip edges pin the total span to 4 s.
        let in_beat = 0.0_f64;
        let out_beat = 4.0_f64; // 8 beats @ 120 bpm
        let map = direct_time_map(
            &[0.0, 1.0, 2.0],
            &[in_beat, 1.5, out_beat],
            0.0,
            2.0,
        );
        let span = output_span(&map);
        let expected = out_beat - in_beat;
        assert!(
            (span - expected).abs() < 1e-6,
            "markers full clip: expected {expected}s output, got {span}",
        );
        let expected_beats = beats_at_120(expected); // 8 beats
        assert!(
            (beats_at_120(span) - expected_beats).abs() < 1e-6,
            "markers full clip: expected {expected_beats} beats, got {}",
            beats_at_120(span),
        );
    }

    /// Case 4 — Real markers inside a clip window, plus boundary anchors.
    /// One internal marker makes the stretch non-linear; the boundary anchors
    /// guarantee the output span is exactly outBeatTime − inBeatTime.
    #[test]
    fn boundary_markers_plus_clip_warp_output_matches_beat_span() {
        // Source 0–2 s; boundary: (0→0, 2→3) = 1.5× average stretch.
        // Internal marker at 1 s → 1.2 s (faster first half, slower second half).
        let clip_in = 0.0_f64;
        let clip_out = 2.0_f64;
        let in_beat = 0.0_f64;
        let out_beat = 3.0_f64; // 6 beats @ 120 bpm
        let map = direct_time_map(
            &[clip_in, 1.0, clip_out],
            &[in_beat, 1.2, out_beat],
            clip_in,
            clip_out,
        );
        let span = output_span(&map);
        let expected = out_beat - in_beat;
        assert!(
            (span - expected).abs() < 1e-6,
            "markers + clip warp: expected {expected}s output, got {span}",
        );
        let expected_beats = beats_at_120(expected); // 6 beats
        assert!(
            (beats_at_120(span) - expected_beats).abs() < 1e-6,
            "markers + clip warp: expected {expected_beats} beats, got {}",
            beats_at_120(span),
        );
    }
}
