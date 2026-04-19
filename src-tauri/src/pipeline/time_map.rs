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
}
