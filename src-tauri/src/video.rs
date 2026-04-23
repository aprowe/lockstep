use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom};

#[derive(serde::Serialize, Clone)]
pub struct VideoInfo {
    pub path: String,
    pub original_name: String,
    pub duration: f64,
    pub fps: f64,
    pub file_hash: String,
    /// Pixel width of the first video stream, if reported by ffprobe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// e.g. "h264", "hevc", "vp9".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_codec: Option<String>,
    /// Container short-name (e.g. "mov,mp4,m4a,3gp,3g2,mj2" — passed through verbatim).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
    /// Bytes on disk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    /// Container bitrate in bits/sec.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitrate: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_codec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_channels: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_sample_rate: Option<u32>,
}

pub fn get_video_info(path: &str) -> Result<VideoInfo, String> {
    let info = crate::ffmpeg::ffprobe_json(path)?;

    let duration = info["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| "ffprobe: missing duration".to_string())?;

    let video_stream = info["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"));

    let fps = video_stream
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

    let width = video_stream
        .and_then(|s| s["width"].as_u64())
        .map(|n| n as u32);
    let height = video_stream
        .and_then(|s| s["height"].as_u64())
        .map(|n| n as u32);
    let video_codec = video_stream
        .and_then(|s| s["codec_name"].as_str())
        .map(|s| s.to_string());

    let audio_stream = info["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "audio"));
    let audio_codec = audio_stream
        .and_then(|s| s["codec_name"].as_str())
        .map(|s| s.to_string());
    let audio_channels = audio_stream
        .and_then(|s| s["channels"].as_u64())
        .map(|n| n as u32);
    let audio_sample_rate = audio_stream
        .and_then(|s| s["sample_rate"].as_str())
        .and_then(|s| s.parse::<u32>().ok());

    let container = info["format"]["format_name"]
        .as_str()
        .map(|s| s.to_string());
    let bitrate = info["format"]["bit_rate"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok());

    let original_name = std::path::Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // file_size is os::metadata-driven so it works even when ffprobe
    // doesn't echo a size field for streamed inputs.
    let file_size = std::fs::metadata(path).ok().map(|m| m.len());

    let file_hash = file_fingerprint(path)?;

    Ok(VideoInfo {
        path: path.to_string(),
        original_name,
        duration,
        fps: (fps * 1000.0).round() / 1000.0,
        file_hash,
        width, height,
        video_codec,
        container,
        file_size,
        bitrate,
        audio_codec,
        audio_channels,
        audio_sample_rate,
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
