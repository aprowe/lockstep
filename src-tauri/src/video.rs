use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom};

#[derive(serde::Serialize, Clone)]
pub struct VideoInfo {
    pub path: String,
    pub original_name: String,
    pub duration: f64,
    pub fps: f64,
    pub file_hash: String,
}

pub fn get_video_info(path: &str) -> Result<VideoInfo, String> {
    let info = crate::ffmpeg::ffprobe_json(path)?;

    let duration = info["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| "ffprobe: missing duration".to_string())?;

    let fps = info["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"))
        .and_then(|s| s["r_frame_rate"].as_str())
        .and_then(|r| {
            let parts: Vec<&str> = r.split('/').collect();
            if parts.len() == 2 {
                let num: f64 = parts[0].parse().ok()?;
                let den: f64 = parts[1].parse().ok()?;
                if den > 0.0 { Some(num / den) } else { None }
            } else {
                r.parse().ok()
            }
        })
        .unwrap_or(30.0);

    let original_name = std::path::Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let file_hash = file_fingerprint(path)?;

    Ok(VideoInfo {
        path: path.to_string(),
        original_name,
        duration,
        fps: (fps * 1000.0).round() / 1000.0,
        file_hash,
    })
}

/// Partial SHA-256: first + last 512 KB + file size → hex[:24]
pub fn file_fingerprint(path: &str) -> Result<String, String> {
    const CHUNK: usize = 512 * 1024;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();

    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];

    let n = file.read(&mut buf).map_err(|e| e.to_string())?;
    hasher.update(&buf[..n]);

    if size > CHUNK as u64 {
        file.seek(SeekFrom::End(-(CHUNK as i64))).map_err(|e| e.to_string())?;
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        hasher.update(&buf[..n]);
    }

    hasher.update(size.to_string().as_bytes());
    let result = hasher.finalize();
    Ok(result[..12].iter().map(|b| format!("{b:02x}")).collect())
}
