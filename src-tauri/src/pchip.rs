/// PCHIP (Piecewise Cubic Hermite Interpolating Polynomial) interpolation.
/// Produces a C1-smooth, monotone-preserving curve through the given control points.
/// Derivatives are computed via the Fritsch-Carlson method.
pub struct Pchip {
    xs: Vec<f64>,
    ys: Vec<f64>,
    ds: Vec<f64>,
}

impl Pchip {
    pub fn new(xs: Vec<f64>, ys: Vec<f64>) -> Self {
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
                // Slope sign reversal — zero derivative preserves monotonicity.
                ds[k] = 0.0;
            } else {
                let w1 = 2.0 * h[k] + h[k - 1];
                let w2 = h[k] + 2.0 * h[k - 1];
                ds[k] = (w1 + w2) / (w1 / delta[k - 1] + w2 / delta[k]);
            }
        }

        Pchip { xs, ys, ds }
    }

    /// First derivative of the interpolant at `x` (local speed ratio orig→output).
    pub fn derivative(&self, x: f64) -> f64 {
        let n = self.xs.len();
        let x = x.clamp(self.xs[0], self.xs[n - 1]);

        let raw = self.xs.partition_point(|&xi| xi < x);
        let i = raw.saturating_sub(1).min(n - 2);

        let h = self.xs[i + 1] - self.xs[i];
        let t = (x - self.xs[i]) / h;
        let t2 = t * t;

        // dH/dt, then multiply by dt/dx = 1/h
        let dh00 = 6.0 * t2 - 6.0 * t;
        let dh10 = 3.0 * t2 - 4.0 * t + 1.0;
        let dh01 = -6.0 * t2 + 6.0 * t;
        let dh11 = 3.0 * t2 - 2.0 * t;

        (dh00 * self.ys[i]
            + dh10 * h * self.ds[i]
            + dh01 * self.ys[i + 1]
            + dh11 * h * self.ds[i + 1])
            / h
    }

    /// Evaluate the interpolant at `x`. Clamps `x` to [xs[0], xs[n-1]].
    pub fn evaluate(&self, x: f64) -> f64 {
        let n = self.xs.len();
        let x = x.clamp(self.xs[0], self.xs[n - 1]);

        // Index of the interval containing x.
        let raw = self.xs.partition_point(|&xi| xi < x);
        let i = raw.saturating_sub(1).min(n - 2);

        let h = self.xs[i + 1] - self.xs[i];
        let t = (x - self.xs[i]) / h;
        let t2 = t * t;
        let t3 = t2 * t;

        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;

        h00 * self.ys[i]
            + h10 * h * self.ds[i]
            + h01 * self.ys[i + 1]
            + h11 * h * self.ds[i + 1]
    }
}

/// Densify a piecewise time map using PCHIP interpolation.
///
/// Inserts interpolated sample points between existing control points so that
/// the speed ratio of each segment changes gradually rather than jumping at
/// anchor boundaries. `interval` is the target sample spacing in seconds;
/// sub-sampling only fires when a gap exceeds 1.5× the interval.
///
/// Falls back to the original control points when fewer than 3 are provided
/// (PCHIP adds no value over linear with only 2 points).
pub fn smooth_time_map(control_points: &[(f64, f64)], interval: f64) -> Vec<(f64, f64)> {
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

        // Always preserve the exact original control point value.
        result.push((x1, y1));
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pchip_hits_control_points() {
        let xs = vec![0.0, 1.0, 2.0, 4.0];
        let ys = vec![0.0, 1.0, 1.5, 4.0];
        let p = Pchip::new(xs.clone(), ys.clone());
        for (&x, &y) in xs.iter().zip(ys.iter()) {
            let got = p.evaluate(x);
            assert!((got - y).abs() < 1e-10, "x={x}: expected {y}, got {got}");
        }
    }

    #[test]
    fn pchip_monotone_on_monotone_data() {
        let xs = vec![0.0, 1.0, 3.0, 6.0];
        let ys = vec![0.0, 1.0, 2.0, 5.0];
        let p = Pchip::new(xs, ys);
        let mut prev = f64::NEG_INFINITY;
        for i in 0..100 {
            let x = i as f64 * 6.0 / 99.0;
            let y = p.evaluate(x);
            assert!(y >= prev - 1e-12, "monotonicity violated at x={x}: {prev} → {y}");
            prev = y;
        }
    }

    #[test]
    fn smooth_time_map_preserves_endpoints_and_control_points() {
        let pts = vec![(0.0, 0.0), (2.0, 2.5), (5.0, 4.0), (8.0, 9.0)];
        let dense = smooth_time_map(&pts, 0.5);

        // First and last must match exactly.
        assert_eq!(dense.first().unwrap(), &pts[0]);
        assert_eq!(dense.last().unwrap(), pts.last().unwrap());

        // All original control points must appear in the output.
        for &pt in &pts {
            assert!(dense.contains(&pt), "missing control point {pt:?}");
        }

        // Output must be strictly increasing in x.
        for w in dense.windows(2) {
            assert!(w[1].0 > w[0].0, "non-monotone x: {:?} → {:?}", w[0], w[1]);
        }
    }
}
