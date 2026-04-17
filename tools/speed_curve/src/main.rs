//! Speed-curve inspector for the PCHIP warp pipeline.
//!
//! Stand-alone tool — no Tauri, no FFmpeg required.
//! Contains an embedded copy of the PCHIP and time-map logic so it can be
//! run without linking to the full `lockstep_lib` crate.
//!
//! ## Usage
//!
//! ```
//! # Built-in fixture (no args needed):
//! cargo run
//!
//! # Custom markers:
//! cargo run -- "0.5:0.5, 2.0:1.8, 4.0:4.2, 6.0:5.9" [clip_duration_secs]
//! ```
//!
//! Marker format: comma-separated `orig_time:beat_time` pairs in seconds.
//!
//! Output:
//!   1. Raw (piecewise-linear) control points + per-segment speed.
//!   2. PCHIP-densified control points (0.5 s sample interval).
//!   3. Smooth speed curve sampled every 0.1 s with Δspeed column.
//!   4. Min/max speed summary and atempo-clamp warnings.

// ── Embedded PCHIP ────────────────────────────────────────────────────────────

struct Pchip {
    xs: Vec<f64>,
    ys: Vec<f64>,
    ds: Vec<f64>,
}

impl Pchip {
    fn new(xs: Vec<f64>, ys: Vec<f64>) -> Self {
        assert!(xs.len() >= 2, "PCHIP requires at least 2 points");
        let n = xs.len();

        let h: Vec<f64> = xs.windows(2).map(|w| w[1] - w[0]).collect();
        let delta: Vec<f64> = ys
            .windows(2)
            .zip(h.iter())
            .map(|(y, &hk)| (y[1] - y[0]) / hk)
            .collect();

        let mut ds = vec![0.0_f64; n];
        ds[0] = delta[0];
        ds[n - 1] = *delta.last().unwrap();

        for k in 1..n - 1 {
            if delta[k - 1] * delta[k] <= 0.0 {
                ds[k] = 0.0;
            } else {
                let w1 = 2.0 * h[k] + h[k - 1];
                let w2 = h[k] + 2.0 * h[k - 1];
                ds[k] = (w1 + w2) / (w1 / delta[k - 1] + w2 / delta[k]);
            }
        }

        Pchip { xs, ys, ds }
    }

    fn evaluate(&self, x: f64) -> f64 {
        let n = self.xs.len();
        let x = x.clamp(self.xs[0], self.xs[n - 1]);
        let raw = self.xs.partition_point(|&xi| xi < x);
        let i = raw.saturating_sub(1).min(n - 2);
        let h = self.xs[i + 1] - self.xs[i];
        let t = (x - self.xs[i]) / h;
        let t2 = t * t;
        let t3 = t2 * t;
        (2.0 * t3 - 3.0 * t2 + 1.0) * self.ys[i]
            + (t3 - 2.0 * t2 + t) * h * self.ds[i]
            + (-2.0 * t3 + 3.0 * t2) * self.ys[i + 1]
            + (t3 - t2) * h * self.ds[i + 1]
    }

    fn derivative(&self, x: f64) -> f64 {
        let n = self.xs.len();
        let x = x.clamp(self.xs[0], self.xs[n - 1]);
        let raw = self.xs.partition_point(|&xi| xi < x);
        let i = raw.saturating_sub(1).min(n - 2);
        let h = self.xs[i + 1] - self.xs[i];
        let t = (x - self.xs[i]) / h;
        let t2 = t * t;
        ((6.0 * t2 - 6.0 * t) * self.ys[i]
            + (3.0 * t2 - 4.0 * t + 1.0) * h * self.ds[i]
            + (-6.0 * t2 + 6.0 * t) * self.ys[i + 1]
            + (3.0 * t2 - 2.0 * t) * h * self.ds[i + 1])
            / h
    }
}

// ── Time-map helpers (mirrors processor.rs logic) ────────────────────────────

fn direct_time_map(
    orig_times: &[f64],
    beat_times: &[f64],
    clip_start: f64,
    clip_end: f64,
) -> Vec<(f64, f64)> {
    let mut pairs: Vec<(f64, f64)> = orig_times
        .iter()
        .copied()
        .zip(beat_times.iter().copied())
        .collect();
    pairs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    let mut cp: Vec<(f64, f64)> = vec![(clip_start, 0.0)];
    for (o, b) in &pairs {
        if *o > cp.last().unwrap().0 + 1e-6 {
            cp.push((*o, *b));
        }
    }
    let (lo, lb) = *cp.last().unwrap();
    if clip_end > lo + 0.001 {
        cp.push((clip_end, lb + (clip_end - lo)));
    }
    cp
}

fn smooth_time_map(control_points: &[(f64, f64)], interval: f64) -> Vec<(f64, f64)> {
    if control_points.len() < 3 {
        return control_points.to_vec();
    }
    let xs: Vec<f64> = control_points.iter().map(|&(x, _)| x).collect();
    let ys: Vec<f64> = control_points.iter().map(|&(_, y)| y).collect();
    let interp = Pchip::new(xs, ys);

    let mut result: Vec<(f64, f64)> = Vec::with_capacity(control_points.len() * 4);
    result.push(*control_points.first().unwrap());

    for window in control_points.windows(2) {
        let (x0, _) = window[0];
        let (x1, y1) = window[1];
        let span = x1 - x0;
        if span > interval * 1.5 {
            let steps = (span / interval).ceil() as usize;
            for j in 1..steps {
                let x = x0 + j as f64 * span / steps as f64;
                result.push((x, interp.evaluate(x)));
            }
        }
        result.push((x1, y1));
    }
    result
}

// ── CLI ───────────────────────────────────────────────────────────────────────

fn parse_markers(s: &str) -> Vec<(f64, f64)> {
    s.split(',')
        .filter_map(|pair| {
            let mut it = pair.trim().splitn(2, ':');
            let o: f64 = it.next()?.trim().parse().ok()?;
            let b: f64 = it.next()?.trim().parse().ok()?;
            Some((o, b))
        })
        .collect()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // ── Input resolution ──────────────────────────────────────────────────
    const FIXTURE: &str = "0.5:0.5, 2.0:1.8, 4.0:4.2, 6.0:5.9, 9.0:9.5";
    const FIXTURE_DURATION: f64 = 10.0;

    let (markers_str, clip_end) = match args.len() {
        1 => {
            println!("No arguments — using built-in fixture.");
            println!("  markers : {FIXTURE}");
            println!("  duration: {FIXTURE_DURATION}s\n");
            (FIXTURE.to_string(), FIXTURE_DURATION)
        }
        2 => (args[1].clone(), 0.0),
        3 => {
            let dur: f64 = args[2].parse().unwrap_or(0.0);
            (args[1].clone(), dur)
        }
        _ => {
            eprintln!("Usage: speed_curve [\"<orig>:<beat>,...\" [clip_duration]]");
            std::process::exit(1);
        }
    };

    let pairs = parse_markers(&markers_str);
    if pairs.is_empty() {
        eprintln!("No valid markers parsed from: {markers_str}");
        std::process::exit(1);
    }

    let orig_times: Vec<f64> = pairs.iter().map(|&(o, _)| o).collect();
    let beat_times: Vec<f64> = pairs.iter().map(|&(_, b)| b).collect();

    let clip_end = if clip_end > 0.0 {
        clip_end
    } else {
        orig_times.iter().copied().fold(f64::NEG_INFINITY, f64::max) + 2.0
    };

    // ── 1. Linear time map ────────────────────────────────────────────────
    let linear = direct_time_map(&orig_times, &beat_times, 0.0, clip_end);
    println!("═══ Linear time map ({} control points) ═══", linear.len());
    for w in linear.windows(2) {
        let (o0, b0) = w[0];
        let (o1, b1) = w[1];
        let speed = (b1 - b0) / (o1 - o0);
        println!("  [{o0:7.3} → {o1:7.3}]  out [{b0:7.3} → {b1:7.3}]  speed {speed:.4}×");
    }

    // ── 2. PCHIP-densified map ────────────────────────────────────────────
    let smooth = smooth_time_map(&linear, 0.5);
    println!("\n═══ PCHIP-densified map ({} control points, 0.5 s interval) ═══", smooth.len());
    for (o, b) in &smooth {
        println!("  orig={o:7.3}s  →  out={b:7.3}s");
    }

    // ── 3. Speed curve (derivative, 0.1 s samples) ────────────────────────
    println!("\n═══ Speed curve (PCHIP derivative, 0.1 s samples) ═══");
    let xs: Vec<f64> = smooth.iter().map(|&(x, _)| x).collect();
    let ys: Vec<f64> = smooth.iter().map(|&(_, y)| y).collect();
    let interp = Pchip::new(xs, ys);

    let x_start = smooth.first().unwrap().0;
    let x_end = smooth.last().unwrap().0;
    let step = 0.1_f64;

    println!("  {:>9}  {:>9}  {:>9}  {:>9}", "orig(s)", "out(s)", "speed×", "Δspeed");
    let mut prev_speed = f64::NAN;
    let mut x = x_start;
    loop {
        let xc = x.min(x_end);
        let y = interp.evaluate(xc);
        let speed = interp.derivative(xc);
        let delta = if prev_speed.is_nan() {
            "        —".to_string()
        } else {
            format!("{:>+9.5}", speed - prev_speed)
        };
        println!("  {:>9.3}  {:>9.3}  {:>9.5}  {delta}", xc, y, speed);
        prev_speed = speed;
        if xc >= x_end {
            break;
        }
        x += step;
    }

    // ── 4. Summary ────────────────────────────────────────────────────────
    let n = 500usize;
    let speeds: Vec<f64> = (0..=n)
        .map(|i| interp.derivative(x_start + i as f64 * (x_end - x_start) / n as f64))
        .collect();
    let min_s = speeds.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_s = speeds.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    println!("\n  speed range: {min_s:.5}× – {max_s:.5}×");
    if min_s < 0.5 || max_s > 2.0 {
        println!("  WARNING: some segments exceed atempo range (0.5×–2.0×) and will be clamped.");
    } else {
        println!("  OK: all speeds within atempo range (0.5×–2.0×).");
    }
}
