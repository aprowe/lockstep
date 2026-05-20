use std::path::Path;
use lockstep_lib::processor::{remap_video, InterpMethod, WarpOptions};

// ── Sidecar JSON types ───────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct Anchor {
    time: f64,
}

#[derive(serde::Deserialize)]
struct DefaultRegion {
    #[serde(rename = "origAnchors")]
    orig_anchors: Vec<Anchor>,
    #[serde(rename = "beatAnchors")]
    beat_anchors: Vec<Anchor>,
    bpm: f64,
}

#[derive(serde::Deserialize)]
struct Region {
    name: String,
    #[serde(rename = "inPoint")]
    in_point: f64,
    #[serde(rename = "outPoint")]
    out_point: f64,
    bpm: f64,
    #[serde(rename = "inBeatTime")]
    in_beat_time: f64,
    #[serde(rename = "outBeatTime")]
    out_beat_time: f64,
}

#[derive(serde::Deserialize)]
struct SavedVideoState {
    #[serde(rename = "defaultRegion")]
    default_region: DefaultRegion,
    #[serde(default)]
    regions: Vec<Region>,
}

// ── Entry point ──────────────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let mut positional: Vec<String> = Vec::new();
    let mut output: Option<String> = None;
    let mut clip_selector: Option<String> = None;
    let mut interp_fps: Option<u32> = None;
    let mut interp_method: InterpMethod = InterpMethod::Minterpolate;
    let mut no_smooth = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-o" | "--output" => {
                i += 1;
                output = args.get(i).cloned();
            }
            "--clip" | "-c" => {
                i += 1;
                clip_selector = args.get(i).cloned();
            }
            "--fps" => {
                i += 1;
                match args.get(i).and_then(|v| v.parse::<u32>().ok()) {
                    Some(n) => interp_fps = Some(n),
                    None => { eprintln!("error: --fps requires a number"); std::process::exit(1); }
                }
            }
            "--interp-method" => {
                i += 1;
                interp_method = InterpMethod::from_str(args.get(i).map(|s| s.as_str()));
            }
            "--no-smooth" => no_smooth = true,
            "--help" | "-h" => { print_usage(); return; }
            arg if arg.starts_with('-') => {
                eprintln!("error: unknown flag '{arg}'");
                print_usage();
                std::process::exit(1);
            }
            _ => positional.push(args[i].clone()),
        }
        i += 1;
    }

    if positional.is_empty() {
        print_usage();
        std::process::exit(1);
    }

    let output = match output {
        Some(o) => o,
        None => {
            eprintln!("error: output path required (-o <path>)");
            print_usage();
            std::process::exit(1);
        }
    };

    // Resolve video + marker paths
    let (video_path, marker_path) = match positional.len() {
        1 => {
            let marker = positional[0].clone();
            match find_sibling_video(&marker) {
                Some(v) => (v, marker),
                None => {
                    eprintln!("error: no sibling video found for '{marker}'");
                    eprintln!("       pass the video path explicitly: lockstep-cli <video> <markers.json> -o <out>");
                    std::process::exit(1);
                }
            }
        }
        2 => (positional[0].clone(), positional[1].clone()),
        _ => {
            eprintln!("error: too many positional arguments");
            print_usage();
            std::process::exit(1);
        }
    };

    // Load + parse marker JSON
    let json_content = match std::fs::read_to_string(&marker_path) {
        Ok(c) => c,
        Err(e) => { eprintln!("error reading marker file: {e}"); std::process::exit(1); }
    };
    let state: SavedVideoState = match serde_json::from_str(&json_content) {
        Ok(s) => s,
        Err(e) => { eprintln!("error parsing marker file: {e}"); std::process::exit(1); }
    };

    let dr = &state.default_region;

    let base_opts = BaseOpts {
        orig_times: dr.orig_anchors.iter().map(|a| a.time).collect(),
        beat_times: dr.beat_anchors.iter().map(|a| a.time).collect(),
        interp_fps,
        interp_method,
        no_smooth,
    };

    // If -o ends with .mp4, it's a single-file output; otherwise it's a directory for batch
    let single_file_output = output.to_lowercase().ends_with(".mp4");

    // Select which clips to run
    if let Some(sel) = clip_selector {
        // Single clip mode: -o is the output file
        let region = select_region(&state.regions, &sel);
        let opts = build_opts(&base_opts, region, dr);
        let label = region.map(|r| r.name.as_str()).unwrap_or("full video");
        run_one(&video_path, &opts, &output, label, interp_fps);
    } else if state.regions.is_empty() || single_file_output {
        // No regions, or output is a specific file: export first region (or full video)
        let region = state.regions.first();
        let opts = build_opts(&base_opts, region, dr);
        let label = region.map(|r| r.name.as_str()).unwrap_or("full video");
        run_one(&video_path, &opts, &output, label, interp_fps);
    } else {
        // Batch mode: -o is the output directory
        let out_dir = Path::new(&output);
        if let Err(e) = std::fs::create_dir_all(out_dir) {
            eprintln!("error creating output directory: {e}");
            std::process::exit(1);
        }
        let total = state.regions.len();
        for (idx, region) in state.regions.iter().enumerate() {
            let safe_name = sanitize_name(&region.name);
            let out_path = out_dir.join(format!("{safe_name}.mp4")).to_string_lossy().to_string();
            println!("[{}/{}] {} → {}", idx + 1, total, region.name, out_path);
            let opts = build_opts(&base_opts, Some(region), dr);
            run_one(&video_path, &opts, &out_path, &region.name, interp_fps);
            println!();
        }
        println!("done: {} clip(s) exported to {output}", total);
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

struct BaseOpts {
    orig_times: Vec<f64>,
    beat_times: Vec<f64>,
    interp_fps: Option<u32>,
    interp_method: InterpMethod,
    no_smooth: bool,
}

fn build_opts(base: &BaseOpts, region: Option<&Region>, dr: &DefaultRegion) -> WarpOptions {
    let clip_in = region.map(|r| r.in_point);
    let clip_out = region.map(|r| r.out_point);
    let eps = 1e-6_f64;

    // Filter global anchors to clip window, excluding exact boundary positions
    // (we inject those from the region's beat times below).
    let in_range = |t: f64| -> bool {
        clip_in.map_or(true, |ci| t >= ci - eps) &&
        clip_out.map_or(true, |co| t <= co + eps)
    };
    let at_boundary = |t: f64| -> bool {
        clip_in.map_or(false, |ci| (t - ci).abs() < eps) ||
        clip_out.map_or(false, |co| (t - co).abs() < eps)
    };
    let mut pairs: Vec<(f64, f64)> = base.orig_times.iter().zip(base.beat_times.iter())
        .filter(|(&o, _)| in_range(o) && !at_boundary(o))
        .map(|(&o, &b)| (o, b))
        .collect();

    // Always inject boundary anchors from the region's beat-space positions.
    if let Some(r) = region {
        pairs.push((r.in_point, r.in_beat_time));
        pairs.push((r.out_point, r.out_beat_time));
        pairs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    }

    WarpOptions {
        orig_times: pairs.iter().map(|p| p.0).collect(),
        beat_times: pairs.iter().map(|p| p.1).collect(),
        bpm: region.map(|r| r.bpm).unwrap_or(dr.bpm),
        clip_in,
        clip_out,
        interp_fps: base.interp_fps,
        interp_method: base.interp_method,
        no_smooth: base.no_smooth,
        scene_cuts: Vec::new(),
        audio_mode: Default::default(),
    }
}

fn select_region<'a>(regions: &'a [Region], sel: &str) -> Option<&'a Region> {
    // Try numeric index first
    if let Ok(idx) = sel.parse::<usize>() {
        return regions.get(idx);
    }
    // Then case-insensitive name substring match
    let lower = sel.to_lowercase();
    regions.iter().find(|r| r.name.to_lowercase().contains(&lower))
}

fn run_one(video_path: &str, opts: &WarpOptions, out_path: &str, label: &str, _interp_fps: Option<u32>) {
    println!("  video:   {video_path}");
    println!("  clip:    {label}");
    if let (Some(ci), Some(co)) = (opts.clip_in, opts.clip_out) {
        println!("  range:   {ci:.3}s – {co:.3}s");
    }
    println!("  bpm:     {}", opts.bpm);
    println!("  anchors: {}", opts.orig_times.len());
    if let Some(fps) = opts.interp_fps {
        println!("  fps:     {fps} (interpolated)");
    }

    match remap_video(video_path, opts, out_path, &|percent, msg| {
        println!("  [{:3.0}%] {msg}", percent * 100.0);
    }) {
        Ok(()) => println!("  → {out_path}"),
        Err(e) => { eprintln!("  error: {e}"); std::process::exit(1); }
    }
}

fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn find_sibling_video(marker_path: &str) -> Option<String> {
    let path = Path::new(marker_path);
    let stem = path.file_stem()?.to_str()?;
    let parent = path.parent().unwrap_or(Path::new("."));
    for ext in &["mp4", "mov", "avi", "mkv", "webm", "m4v"] {
        let candidate = parent.join(format!("{stem}.{ext}"));
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

fn print_usage() {
    eprintln!("usage:");
    eprintln!("  lockstep-cli [video] markers.json -o <dir>          export all clips");
    eprintln!("  lockstep-cli [video] markers.json --clip 0 -o out.mp4    by index");
    eprintln!("  lockstep-cli [video] markers.json --clip \"Verse\" -o out.mp4  by name");
    eprintln!();
    eprintln!("  If video is omitted, looks for a sibling video file next to markers.json.");
    eprintln!("  If the marker file has no regions, the full video is exported.");
    eprintln!();
    eprintln!("options:");
    eprintln!("  -o, --output <path>    output file or directory (required)");
    eprintln!("  -c, --clip <idx|name>  select a single clip (index or name substring)");
    eprintln!("  --fps <n>              output at constant <n> fps with frame interpolation");
    eprintln!("  --interp-method <m>    interpolation method: minterpolate (default) | rife");
    eprintln!("  --no-smooth            skip PCHIP smoothing; use raw linear time map (debug)");
}
