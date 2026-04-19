//! Pipeline input: the `WarpOptions` struct and `InterpMethod` enum.
//!
//! Kept in its own file so pure stages (time_map, segments) can borrow just the
//! subset of fields they need without taking a dependency on the full request.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InterpMethod {
    /// ffmpeg minterpolate=mi_mode=blend, applied per segment during the warp pass.
    #[default]
    Minterpolate,
    /// RIFE neural interpolation via the rife-ncnn-vulkan binary, applied as a
    /// single post-concat pass. See rife.rs.
    Rife,
}

impl InterpMethod {
    /// Parse a frontend string ("minterpolate" | "rife" | None). Unknown → default.
    pub fn from_str(s: Option<&str>) -> Self {
        match s.map(|v| v.to_ascii_lowercase()).as_deref() {
            Some("rife") => Self::Rife,
            _ => Self::Minterpolate,
        }
    }
}

pub struct WarpOptions {
    pub orig_times: Vec<f64>,
    pub beat_times: Vec<f64>,
    pub bpm: f64,
    pub beat_zero_time: f64,
    pub add_to_end: bool,
    pub trim_to_loop: bool,
    pub loop_beats: Option<u32>,
    pub normalize_bpm: bool,
    pub fade_at_loop: bool,
    /// Start of clip in source video (seconds). None = 0.0
    pub clip_in: Option<f64>,
    /// End of clip in source video (seconds). None = video duration
    pub clip_out: Option<f64>,
    /// When set, each segment is encoded at this constant fps with blend interpolation,
    /// or fed through RIFE post-concat (see `interp_method`).
    pub interp_fps: Option<u32>,
    /// Which interpolation algorithm to use when `interp_fps` is Some.
    pub interp_method: InterpMethod,
    /// When true, skip PCHIP smoothing and use the raw piecewise-linear time map.
    /// Useful for debugging RIFE pair artefacts caused by near-flat densified regions.
    pub no_smooth: bool,
}
