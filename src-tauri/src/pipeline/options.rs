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

/// How the audio track is handled during the warp.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AudioMode {
    /// Strip audio entirely (`-an`). Output is silent.
    None,
    /// Pitch follows speed: `asetrate=SR/ratio,aresample=SR`. Slowed video
    /// drops in pitch, sped-up video rises — like a turntable.
    Pitch,
    /// Tempo-stretch with `atempo`: pitch is preserved while length matches
    /// the new video duration. Default for parity with prior behavior.
    #[default]
    Tempo,
}

impl AudioMode {
    /// Parse a frontend string ("none" | "pitch" | "tempo"). Unknown → default.
    pub fn from_str(s: Option<&str>) -> Self {
        match s.map(|v| v.to_ascii_lowercase()).as_deref() {
            Some("none") | Some("off") | Some("mute") => Self::None,
            Some("pitch") | Some("pitched") => Self::Pitch,
            _ => Self::Tempo,
        }
    }
}

pub struct WarpOptions {
    pub orig_times: Vec<f64>,
    pub beat_times: Vec<f64>,
    pub bpm: f64,
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
    pub no_smooth: bool,
    /// Source-time positions (seconds) of hard scene cuts. RIFE uses this to
    /// avoid blending two frames that straddle a cut — it holds instead.
    /// Empty = no awareness; behaves like before.
    pub scene_cuts: Vec<f64>,
    /// How the audio is muxed into the output. See `AudioMode`.
    pub audio_mode: AudioMode,
}
