//! Functional pipeline: `WarpOptions` → output file, in composable stages.
//!
//! The orchestrator (`crate::processor::remap_video`) chains these together.
//! Each stage is defined in its own module so it can be tested and validated
//! in isolation.
//!
//! ```text
//!   WarpOptions
//!      │
//!      ▼
//!   time_map::build_time_map      (pure)
//!      │
//!      ▼
//!   segments::plan_segments       (pure)
//!      │
//!      ▼
//!   segments::encode_segments     (I/O: ffmpeg per segment)
//!      │
//!      ▼
//!   segments::concat_segments     (I/O: ffmpeg concat demuxer)
//!      │
//!      ▼
//!   rife_pass::apply_warp_aware_rife  (optional, I/O)
//! ```

pub mod options;
pub mod rife_pass;
pub mod segments;
pub mod time_map;

pub use options::{AudioMode, InterpMethod, WarpOptions};
pub use segments::SegmentPlan;
pub use time_map::TimeMap;
