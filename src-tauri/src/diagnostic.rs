use std::io::{Read, Write};
use std::process::{Command, Stdio};

// ── FFprobe helpers ──────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct VideoMeta {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    /// Sorted keyframe pts times (seconds)
    pub keyframe_times: Vec<f64>,
    /// Best-guess GOP size (frames)
    pub gop_size: u32,
}

pub fn probe_video_meta(path: &str) -> Result<VideoMeta, String> {
    // Basic stream info
    let basic = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate,nb_frames:format=duration",
            "-of", "json",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe not found: {e}"))?;

    let info: serde_json::Value = serde_json::from_slice(&basic.stdout)
        .map_err(|e| format!("ffprobe JSON parse: {e}"))?;

    let stream = &info["streams"][0];

    let width = stream["width"].as_u64().ok_or("missing width")? as u32;
    let height = stream["height"].as_u64().ok_or("missing height")? as u32;

    let fps = stream["r_frame_rate"]
        .as_str()
        .and_then(|s| {
            let p: Vec<&str> = s.split('/').collect();
            if p.len() == 2 {
                let n: f64 = p[0].parse().ok()?;
                let d: f64 = p[1].parse().ok()?;
                if d > 0.0 { Some(n / d) } else { None }
            } else { s.parse().ok() }
        })
        .unwrap_or(30.0);

    let duration = info["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or("missing duration")?;

    // Keyframe probe (stream-copy speed; reads packets not frames)
    let kf_out = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-select_streams", "v:0",
            "-skip_frame", "nokey",
            "-show_entries", "frame=pts_time,key_frame",
            "-of", "json",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe keyframe scan: {e}"))?;

    let kf_json: serde_json::Value = serde_json::from_slice(&kf_out.stdout)
        .unwrap_or(serde_json::json!({"frames": []}));

    let mut keyframe_times: Vec<f64> = kf_json["frames"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter(|f| f["key_frame"].as_u64() == Some(1))
        .filter_map(|f| f["pts_time"].as_str()?.parse::<f64>().ok())
        .collect();
    keyframe_times.sort_by(|a, b| a.partial_cmp(b).unwrap());

    // Estimate GOP size from average keyframe interval
    let gop_size = if keyframe_times.len() >= 2 {
        let intervals: Vec<f64> = keyframe_times.windows(2).map(|w| w[1] - w[0]).collect();
        let avg_interval = intervals.iter().sum::<f64>() / intervals.len() as f64;
        (avg_interval * fps).round().max(1.0) as u32
    } else {
        (2.0 * fps).round() as u32 // default 2-second GOP
    };

    Ok(VideoMeta { width, height, fps, duration, keyframe_times, gop_size })
}

// ── Canvas (BGR24 pixel buffer + drawing primitives) ─────────────────────────

struct Canvas {
    data: Vec<u8>,
    w: u32,
    h: u32,
}

impl Canvas {
    fn new(w: u32, h: u32, bg: [u8; 3]) -> Self {
        let mut data = vec![0u8; (w * h * 3) as usize];
        for i in 0..((w * h) as usize) {
            data[i * 3] = bg[0];
            data[i * 3 + 1] = bg[1];
            data[i * 3 + 2] = bg[2];
        }
        Canvas { data, w, h }
    }

    fn put(&mut self, x: i32, y: i32, bgr: [u8; 3]) {
        if x >= 0 && y >= 0 && (x as u32) < self.w && (y as u32) < self.h {
            let i = (y as usize * self.w as usize + x as usize) * 3;
            self.data[i] = bgr[0];
            self.data[i + 1] = bgr[1];
            self.data[i + 2] = bgr[2];
        }
    }

    fn blend(&mut self, x: i32, y: i32, bgr: [u8; 3], alpha: f32) {
        if x >= 0 && y >= 0 && (x as u32) < self.w && (y as u32) < self.h {
            let i = (y as usize * self.w as usize + x as usize) * 3;
            for c in 0..3 {
                self.data[i + c] = (self.data[i + c] as f32 * (1.0 - alpha)
                    + bgr[c] as f32 * alpha)
                    .clamp(0.0, 255.0) as u8;
            }
        }
    }

    /// Fill a rectangle (inclusive bounds)
    fn fill_rect(&mut self, x: i32, y: i32, w: i32, h: i32, bgr: [u8; 3]) {
        for row in y..(y + h) {
            for col in x..(x + w) {
                self.put(col, row, bgr);
            }
        }
    }

    fn blend_rect(&mut self, x: i32, y: i32, w: i32, h: i32, bgr: [u8; 3], alpha: f32) {
        for row in y..(y + h) {
            for col in x..(x + w) {
                self.blend(col, row, bgr, alpha);
            }
        }
    }

    /// Bresenham line — stamps circles of radius `r` for thickness
    fn line(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, bgr: [u8; 3], r: i32) {
        let dx = (x1 - x0).abs();
        let dy = -(y1 - y0).abs();
        let sx: i32 = if x0 < x1 { 1 } else { -1 };
        let sy: i32 = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;
        let (mut x, mut y) = (x0, y0);
        loop {
            self.circle(x, y, r, bgr, true);
            if x == x1 && y == y1 { break; }
            let e2 = 2 * err;
            if e2 >= dy { err += dy; x += sx; }
            if e2 <= dx { err += dx; y += sy; }
        }
    }

    /// Midpoint circle algorithm
    fn circle(&mut self, cx: i32, cy: i32, r: i32, bgr: [u8; 3], filled: bool) {
        if r <= 0 { self.put(cx, cy, bgr); return; }
        if filled {
            for dy in -r..=r {
                let dx = ((r * r - dy * dy) as f64).sqrt() as i32;
                for x in (cx - dx)..=(cx + dx) {
                    self.put(x, cy + dy, bgr);
                }
            }
        } else {
            let mut x = r;
            let mut y = 0i32;
            let mut d = 1 - r;
            while x >= y {
                for &(px, py) in &[
                    (cx+x,cy+y),(cx-x,cy+y),(cx+x,cy-y),(cx-x,cy-y),
                    (cx+y,cy+x),(cx-y,cy+x),(cx+y,cy-x),(cx-y,cy-x),
                ] { self.put(px, py, bgr); }
                y += 1;
                if d > 0 { x -= 1; d += 2*(y-x)+1; } else { d += 2*y+1; }
            }
        }
    }

    fn blend_circle(&mut self, cx: i32, cy: i32, r: i32, bgr: [u8; 3], alpha: f32) {
        for dy in -r..=r {
            let dx = ((r * r - dy * dy) as f64).sqrt() as i32;
            for x in (cx - dx)..=(cx + dx) {
                self.blend(x, cy + dy, bgr, alpha);
            }
        }
    }

    // ── 7-segment digit rendering ─────────────────────────────────────────────

    // Bit layout: a=0(top), b=1(top-right), c=2(bot-right), d=3(bot),
    //             e=4(bot-left), f=5(top-left), g=6(middle)
    const SEGS: [u8; 10] = [
        0b0111111, // 0
        0b0000110, // 1
        0b1011011, // 2
        0b1001111, // 3
        0b1100110, // 4
        0b1101101, // 5
        0b1111101, // 6
        0b0000111, // 7
        0b1111111, // 8
        0b1101111, // 9
    ];

    /// Draw a 7-segment digit. (x,y) = top-left, h = total height.
    fn seg_digit(&mut self, digit: u8, x: i32, y: i32, h: i32, bgr: [u8; 3]) {
        if digit > 9 { return; }
        let segs = Self::SEGS[digit as usize];
        let w = h / 2;
        let t = (h / 14).max(1); // segment thickness radius
        let mx = x + w / 2;      // midpoint x of horizontal segments
        let my = y + h / 2;      // midpoint y (middle of digit)

        // Horizontal segments (a, g, d)
        let draw_h = |this: &mut Canvas, yy: i32| {
            this.line(x + t + 1, yy, x + w - t - 1, yy, bgr, t);
        };
        // Vertical segments (f, b top-left/top-right; e, c bot-left/bot-right)
        let draw_v = |this: &mut Canvas, xx: i32, y0: i32, y1: i32| {
            this.line(xx, y0 + t + 1, xx, y1 - t - 1, bgr, t);
        };

        if segs & (1 << 0) != 0 { draw_h(self, y); }              // a top
        if segs & (1 << 3) != 0 { draw_h(self, y + h); }          // d bottom
        if segs & (1 << 6) != 0 { draw_h(self, my); }             // g middle
        if segs & (1 << 1) != 0 { draw_v(self, x + w, y, my); }   // b top-right
        if segs & (1 << 2) != 0 { draw_v(self, x + w, my, y + h); } // c bot-right
        if segs & (1 << 5) != 0 { draw_v(self, x, y, my); }       // f top-left
        if segs & (1 << 4) != 0 { draw_v(self, x, my, y + h); }   // e bot-left

        let _ = (mx, draw_h, draw_v); // suppress unused warnings
    }

    /// Draw a colon separator for time display
    fn seg_colon(&mut self, x: i32, y: i32, h: i32, bgr: [u8; 3]) {
        let r = (h / 12).max(1);
        let w = h / 4;
        self.circle(x + w / 2, y + h / 3, r, bgr, true);
        self.circle(x + w / 2, y + 2 * h / 3, r, bgr, true);
    }

    /// Draw a dot separator
    fn seg_dot(&mut self, x: i32, y: i32, h: i32, bgr: [u8; 3]) {
        let r = (h / 12).max(1);
        let w = h / 4;
        self.circle(x + w / 2, y + h - r, r, bgr, true);
    }

    /// Returns the width consumed for the next draw_number call
    fn seg_char_width(h: i32, ch: char) -> i32 {
        match ch {
            ':' | '.' => h / 4 + 2,
            ' ' => h / 4,
            _ => h / 2 + 4, // digit
        }
    }

    /// Draw a string of digits and separators. Returns new x position.
    fn seg_string(&mut self, s: &str, mut x: i32, y: i32, h: i32, bgr: [u8; 3]) -> i32 {
        for ch in s.chars() {
            match ch {
                '0'..='9' => {
                    self.seg_digit(ch as u8 - b'0', x, y, h, bgr);
                    x += h / 2 + 4;
                }
                ':' => { self.seg_colon(x, y, h, bgr); x += h / 4 + 2; }
                '.' => { self.seg_dot(x, y, h, bgr); x += h / 4 + 2; }
                ' ' => { x += h / 4; }
                _ => {}
            }
        }
        x
    }

    // ── Metronome components ──────────────────────────────────────────────────

    /// Pendulum: pivot at (cx, pivot_y), arm length `arm`, bob radius `bob_r`
    fn draw_pendulum(
        &mut self,
        cx: i32, pivot_y: i32, arm: i32, bob_r: i32,
        phase: f64,    // 0..1 within beat cycle
        flash: f64,    // 0..1 beat flash intensity
        color: [u8; 3],
    ) {
        use std::f64::consts::PI;
        let angle = -(PI / 4.5) * (2.0 * PI * phase).cos();
        let bob_x = cx + (arm as f64 * angle.sin()) as i32;
        let bob_y = pivot_y + (arm as f64 * angle.cos()) as i32;

        // Flash-brightened color
        let bright = lerp_color(color, [255, 255, 255], (flash * 0.7) as f32);

        // Arm shadow
        self.line(cx, pivot_y, bob_x + 1, bob_y + 1, [0, 0, 0], 2);
        // Arm
        self.line(cx, pivot_y, bob_x, bob_y, bright, 2);

        // Pivot
        self.circle(cx, pivot_y, 6, [0, 0, 0], true);
        self.circle(cx, pivot_y, 5, bright, true);

        // Glow halo on beat
        if flash > 0.05 {
            let halo_r = (14.0 + flash * 14.0) as i32;
            self.blend_circle(cx, pivot_y, halo_r, bright, (flash * 0.5) as f32);
        }

        // Bob
        let r = bob_r + (flash * 6.0) as i32;
        if flash > 0.05 {
            self.blend_circle(bob_x, bob_y, r + 5, lerp_color(color, [255,255,255], (flash*0.25) as f32), (flash * 0.4) as f32);
        }
        self.circle(bob_x, bob_y, r, bright, true);
    }

    /// Timeline strip: horizontal band showing beat tick marks + playhead
    fn draw_timeline(
        &mut self,
        x0: i32, x1: i32, y: i32, h: i32,
        t: f64, duration: f64,
        bpm: f64, beat_zero: f64,
        color: [u8; 3],
    ) {
        let strip_w = x1 - x0;

        // Background
        self.fill_rect(x0, y - h, strip_w, h * 2, [22, 22, 32]);

        // Centre baseline
        for x in x0..x1 {
            self.put(x, y, [40, 40, 56]);
        }

        // Beat ticks
        if bpm > 0.0 {
            let beat_interval = 60.0 / bpm;
            let mut bt = beat_zero % (duration + beat_interval);
            // Walk from 0 so we see all beats even before beat_zero
            let mut b = beat_zero - (beat_zero / beat_interval).ceil() * beat_interval;
            while b < 0.0 { b += beat_interval; }
            loop {
                if b > duration { break; }
                let bx = x0 + ((b / duration) * strip_w as f64) as i32;
                let beat_flash = if (t - b).abs() < 1.0 {
                    (-10.0 * (t - b).abs()).exp()
                } else { 0.0 };
                let tc = lerp_color(color, [255, 255, 255], (beat_flash * 0.8) as f32);
                let tick_h = ((h as f64) * (0.4 + beat_flash * 0.6)) as i32;
                self.line(bx, y - tick_h, bx, y + tick_h, tc, 1);
                b += beat_interval;
                bt += beat_interval;
                if b - beat_zero > duration + beat_interval { break; }
            }
        }

        // Playhead cursor
        let px = x0 + ((t / duration) * strip_w as f64) as i32;
        self.line(px, y - h - 4, px, y + h + 4, [200, 200, 220], 1);
    }

    /// Full-frame beat flash (brightens everything)
    fn apply_beat_flash(&mut self, flash: f64, color: [u8; 3]) {
        if flash < 0.01 { return; }
        let alpha = (flash * 0.55) as f32;
        for i in 0..((self.w * self.h) as usize) {
            let base = i * 3;
            for c in 0..3 {
                self.data[base + c] = (self.data[base + c] as f32 * (1.0 - alpha)
                    + color[c] as f32 * alpha)
                    .clamp(0.0, 255.0) as u8;
            }
        }
    }
}

fn lerp_color(a: [u8; 3], b: [u8; 3], t: f32) -> [u8; 3] {
    [
        (a[0] as f32 + (b[0] as f32 - a[0] as f32) * t) as u8,
        (a[1] as f32 + (b[1] as f32 - a[1] as f32) * t) as u8,
        (a[2] as f32 + (b[2] as f32 - a[2] as f32) * t) as u8,
    ]
}

fn format_time(t: f64) -> String {
    let total_ms = (t * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let secs = (total_ms / 1000) % 60;
    let mins = (total_ms / 60000) % 60;
    format!("{:02}:{:02}.{:03}", mins, secs, ms)
}

// ── Draw a complete diagnostic frame (replaces source content) ───────────────

fn draw_diagnostic_frame(
    canvas: &mut Canvas,
    t: f64,
    duration: f64,
    bpm: f64,
    beat_zero: f64,
    is_keyframe: bool,
    frame_idx: u64,
) {
    let w = canvas.w as i32;
    let h = canvas.h as i32;

    // Background
    canvas.fill_rect(0, 0, w, h, [20, 14, 14]);

    let beat_interval = if bpm > 0.0 { 60.0 / bpm } else { 0.0 };
    let phase = if beat_interval > 0.0 {
        ((t - beat_zero).rem_euclid(beat_interval) / beat_interval).clamp(0.0, 1.0)
    } else { 0.0 };
    let flash = if beat_interval > 0.0 {
        let elapsed = (t - beat_zero).rem_euclid(beat_interval);
        (-10.0f64 * elapsed).exp()
    } else { 0.0 };

    // Color for this session (amber)
    let color: [u8; 3] = [80, 160, 255]; // BGR: blue-ish

    // ── Beat flash (applied at end) ──────────────────────────────────────────
    // (save flash value for later)

    // ── Keyframe indicator strip ─────────────────────────────────────────────
    if is_keyframe {
        canvas.fill_rect(0, 0, w, 6, [0, 255, 255]); // cyan top stripe = keyframe
    }

    // ── Pendulum ─────────────────────────────────────────────────────────────
    let pivot_x = w / 2;
    let pivot_y = h * 28 / 100;
    let arm_len = h * 22 / 100;
    let bob_r = h * 2 / 100;
    canvas.draw_pendulum(pivot_x, pivot_y, arm_len, bob_r, phase, flash, color);

    // ── BPM label ────────────────────────────────────────────────────────────
    let seg_h = h * 7 / 100;
    let bpm_str = format!("{:.0}", bpm);
    let label_x = w / 2 - seg_h * bpm_str.len() as i32 / 2;
    canvas.seg_string(&bpm_str, label_x, h * 5 / 100, seg_h, color);

    // ── Timeline strip ───────────────────────────────────────────────────────
    let tl_y = h * 72 / 100;
    let tl_h = h * 4 / 100;
    canvas.draw_timeline(
        w * 5 / 100, w * 95 / 100, tl_y, tl_h,
        t, duration, bpm, beat_zero, color,
    );

    // ── Progress bar ─────────────────────────────────────────────────────────
    let pb_y = h * 92 / 100;
    let pb_h = h * 3 / 100;
    canvas.fill_rect(0, pb_y, w, pb_h, [30, 30, 44]);
    let filled_w = ((t / duration) * w as f64) as i32;
    canvas.fill_rect(0, pb_y, filled_w, pb_h, lerp_color([40, 80, 140], [255, 255, 255], (flash * 0.5) as f32));

    // ── Info: timestamp + frame number ───────────────────────────────────────
    let info_h = h * 5 / 100;
    let time_str = format_time(t);
    canvas.seg_string(&time_str, w * 5 / 100, pb_y + pb_h + 4, info_h, [160, 160, 180]);

    let frame_str = format!("{:06}", frame_idx);
    let fw: i32 = frame_str.chars().map(|c| Canvas::seg_char_width(info_h, c)).sum();
    canvas.seg_string(&frame_str, w - w * 5 / 100 - fw, pb_y + pb_h + 4, info_h,
        if is_keyframe { [0, 255, 200] } else { [100, 100, 120] });

    // ── Apply beat flash over everything ─────────────────────────────────────
    canvas.apply_beat_flash(flash, [255, 220, 180]);
}

// ── Draw metronome overlay on top of an existing frame ───────────────────────

fn draw_overlay_frame(
    canvas: &mut Canvas,
    t: f64,
    duration: f64,
    bpm: f64,
    beat_zero: f64,
    is_keyframe: bool,
    frame_idx: u64,
) {
    let w = canvas.w as i32;
    let h = canvas.h as i32;

    let beat_interval = if bpm > 0.0 { 60.0 / bpm } else { 0.0 };
    let phase = if beat_interval > 0.0 {
        ((t - beat_zero).rem_euclid(beat_interval) / beat_interval).clamp(0.0, 1.0)
    } else { 0.0 };
    let flash = if beat_interval > 0.0 {
        let elapsed = (t - beat_zero).rem_euclid(beat_interval);
        (-10.0f64 * elapsed).exp()
    } else { 0.0 };

    let color: [u8; 3] = [80, 200, 255]; // BGR amber-ish

    // ── Full-frame beat flash ────────────────────────────────────────────────
    canvas.apply_beat_flash(flash * 0.45, [200, 220, 255]);

    // ── Keyframe marker ──────────────────────────────────────────────────────
    if is_keyframe {
        canvas.fill_rect(0, 0, w, 4, [0, 255, 255]);
    }

    // ── Bottom HUD bar ───────────────────────────────────────────────────────
    let hud_h = (h as f64 * 0.18) as i32;
    let hud_y = h - hud_h;
    canvas.blend_rect(0, hud_y, w, hud_h, [14, 14, 20], 0.72);

    // Progress bar inside HUD
    let pb_y = h - 8;
    let filled_w = ((t / duration) * w as f64) as i32;
    canvas.fill_rect(0, pb_y, w, 8, [30, 30, 44]);
    canvas.fill_rect(0, pb_y, filled_w, 8, lerp_color([60, 120, 200], [255, 255, 255], (flash * 0.6) as f32));

    // Timeline strip inside HUD
    let tl_y = h - hud_h / 2;
    let tl_h = hud_h / 6;
    let tl_x0 = w / 4;
    let tl_x1 = w * 3 / 4;
    canvas.draw_timeline(tl_x0, tl_x1, tl_y, tl_h, t, duration, bpm, beat_zero, color);

    // ── Mini pendulum (bottom-left of HUD) ───────────────────────────────────
    let pend_cx = w / 8;
    let pend_pivot_y = hud_y + hud_h / 3;
    let pend_arm = hud_h * 5 / 12;
    let pend_bob_r = hud_h / 12;
    canvas.draw_pendulum(pend_cx, pend_pivot_y, pend_arm, pend_bob_r, phase, flash, color);

    // ── Info text (timestamp + frame) ─────────────────────────────────────────
    let info_h = hud_h * 5 / 14;
    let time_str = format_time(t);
    canvas.seg_string(&time_str, w * 5 / 8, hud_y + hud_h * 2 / 8, info_h, color);

    let frame_str = format!("{:05}", frame_idx);
    canvas.seg_string(&frame_str, w * 5 / 8, hud_y + hud_h * 5 / 8, info_h,
        if is_keyframe { [0, 255, 200] } else { [100, 100, 120] });
}

// ── Diagnostic video pipeline ────────────────────────────────────────────────
//
// Generates a new video that has the SAME timing structure as the source
// (same fps, same duration, same approximate keyframe positions) but with
// the pixel content replaced by a metronome/timeline visualization.

pub fn generate_diagnostic_video<F>(
    source: &str,
    output: &str,
    bpm: f64,
    beat_zero: f64,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str),
{
    progress(0.02, "Probing source video...");

    let meta = probe_video_meta(source)?;
    let total_frames = (meta.duration * meta.fps).round() as u64;

    progress(0.08, "Starting encoder...");

    // Build keyframe time list (limit to avoid OS command-line length limits)
    let kf_arg: String = meta
        .keyframe_times
        .iter()
        .take(400)
        .map(|t| format!("{t:.4}"))
        .collect::<Vec<_>>()
        .join(",");

    let size = format!("{}x{}", meta.width, meta.height);
    let fps_str = format!("{:.4}", meta.fps);
    let gop_str = format!("{}", meta.gop_size);

    let mut enc_args = vec![
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", &size,
        "-pix_fmt", "bgr24",
        "-r", &fps_str,
        "-i", "pipe:0",
        "-c:v", "libx264", "-preset", "fast", "-crf", "17",
        "-pix_fmt", "yuv420p",
        "-g", &gop_str,
    ];

    if !kf_arg.is_empty() {
        enc_args.extend(["-force_key_frames", &kf_arg]);
    }
    enc_args.push(output);

    let mut encoder = Command::new("ffmpeg")
        .args(&enc_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg encoder: {e}"))?;

    let stdin = encoder.stdin.as_mut().ok_or("No stdin")?;

    // Build a set of keyframe timestamps for per-frame lookup
    let kf_set: std::collections::HashSet<u64> = meta
        .keyframe_times
        .iter()
        .map(|&t| (t * meta.fps).round() as u64)
        .collect();

    let frame_size = (meta.width * meta.height * 3) as usize;

    for frame_idx in 0..total_frames {
        let t = frame_idx as f64 / meta.fps;
        let is_kf = kf_set.contains(&frame_idx);

        let mut canvas = Canvas::new(meta.width, meta.height, [20, 14, 14]);
        draw_diagnostic_frame(&mut canvas, t, meta.duration, bpm, beat_zero, is_kf, frame_idx);

        stdin
            .write_all(&canvas.data[..frame_size])
            .map_err(|e| format!("Write error at frame {frame_idx}: {e}"))?;

        if frame_idx % 60 == 0 {
            let p = 0.08 + 0.90 * frame_idx as f64 / total_frames as f64;
            progress(p, &format!("Frame {frame_idx}/{total_frames}"));
        }
    }

    drop(stdin);
    encoder.wait().map_err(|e| format!("Encoder wait error: {e}"))?;

    progress(1.0, "Done");
    Ok(())
}

// ── Overlay video pipeline ───────────────────────────────────────────────────
//
// Reads source frames, draws the metronome HUD on top, re-encodes, then muxes
// the original audio back in.

pub fn generate_overlay_video<F>(
    source: &str,
    output: &str,
    bpm: f64,
    beat_zero: f64,
    progress: &F,
) -> Result<(), String>
where
    F: Fn(f64, &str),
{
    progress(0.02, "Probing source video...");

    let meta = probe_video_meta(source)?;
    let total_frames = (meta.duration * meta.fps).round() as u64;
    let frame_size = (meta.width * meta.height * 3) as usize;

    progress(0.08, "Starting video decode...");

    // Decoder: source → raw BGR frames
    let mut decoder = Command::new("ffmpeg")
        .args([
            "-i", source,
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-an",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg decoder: {e}"))?;

    // Intermediate: video-only file (we mux audio back in a second pass)
    let tmp_video = format!("{output}.tmp_video.mp4");
    let size = format!("{}x{}", meta.width, meta.height);
    let fps_str = format!("{:.4}", meta.fps);
    let gop_str = format!("{}", meta.gop_size);

    let mut encoder = Command::new("ffmpeg")
        .args([
            "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-vcodec", "rawvideo",
            "-s", &size,
            "-pix_fmt", "bgr24",
            "-r", &fps_str,
            "-i", "pipe:0",
            "-c:v", "libx264", "-preset", "fast", "-crf", "17",
            "-pix_fmt", "yuv420p",
            "-g", &gop_str,
            &tmp_video,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg encoder: {e}"))?;

    let kf_set: std::collections::HashSet<u64> = meta
        .keyframe_times
        .iter()
        .map(|&t| (t * meta.fps).round() as u64)
        .collect();

    let dec_stdout = decoder.stdout.as_mut().ok_or("No decoder stdout")?;
    let enc_stdin = encoder.stdin.as_mut().ok_or("No encoder stdin")?;
    let mut buf = vec![0u8; frame_size];
    let mut frame_idx = 0u64;

    loop {
        match dec_stdout.read_exact(&mut buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(format!("Decode read error: {e}")),
        }

        let t = frame_idx as f64 / meta.fps;
        let is_kf = kf_set.contains(&frame_idx);

        let mut canvas = Canvas { data: buf.clone(), w: meta.width, h: meta.height };
        draw_overlay_frame(&mut canvas, t, meta.duration, bpm, beat_zero, is_kf, frame_idx);

        enc_stdin
            .write_all(&canvas.data)
            .map_err(|e| format!("Encode write error at frame {frame_idx}: {e}"))?;

        if frame_idx % 60 == 0 {
            let p = 0.08 + 0.85 * frame_idx as f64 / total_frames.max(1) as f64;
            progress(p, &format!("Frame {frame_idx}/{total_frames}"));
        }

        frame_idx += 1;
    }

    drop(enc_stdin);
    encoder.wait().map_err(|e| format!("Encoder wait: {e}"))?;
    decoder.wait().ok();

    // Mux original audio into final output
    progress(0.94, "Muxing audio...");

    let mux_result = crate::ffmpeg::run_ffmpeg(&[
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", &tmp_video,
        "-i", source,
        "-map", "0:v:0",
        "-map", "1:a:0?",
        "-c", "copy",
        output,
    ]);

    let _ = std::fs::remove_file(&tmp_video);

    // If mux with audio failed (no audio track), just rename the video-only file
    if mux_result.is_err() {
        std::fs::rename(&tmp_video, output)
            .or_else(|_| crate::ffmpeg::run_ffmpeg(&[
                "-y", "-hide_banner", "-loglevel", "error",
                "-i", &format!("{output}.tmp_video.mp4"),
                "-c", "copy",
                output,
            ]))
            .ok();
    }

    progress(1.0, "Done");
    Ok(())
}
