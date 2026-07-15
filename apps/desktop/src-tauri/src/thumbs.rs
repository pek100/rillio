//! Trickplay: seek-bar hover thumbnails from a SHADOW mpv instance.
//!
//! Design after Harbor's thumbs sidecar (github.com/harborstremio/harbor,
//! MIT License, (c) Harbor contributors), reworked for an in-process libmpv:
//! Harbor spawns an `mpv.exe --input-ipc-server` subprocess because that is
//! what they ship; we ship only `libmpv-2.dll`, and libmpv supports multiple
//! independent contexts per process, so the shadow here is simply a second
//! [`Mpv`] with no window (`vo=null`), no audio, and a decode chain scaled to
//! thumbnail width - which makes both decoding and the screenshots cheap.
//!
//! The shadow opens the SAME url the player is streaming (normally the local
//! streaming server), seeks by keyframe to a bucketed time, and screenshots to
//! a temp jpg that returns to the web layer as a data URL. Keyframe seeks land
//! wherever the nearest keyframe is; a hover preview is an approximation by
//! nature, and this is what keeps it fast. For a torrent, a request into a
//! not-yet-downloaded region is just a range request the streaming server can
//! serve later: the seek stalls, the settle wait times out, no thumb is cached,
//! and a later hover retries.
//!
//! Concurrency: one worker thread, "latest wins" - while the user scrubs, only
//! the bucket under the cursor right now is worth generating, so `wanted`
//! holds at most one pending bucket and every newer request overwrites it. The
//! web layer polls (a miss returns `None` and the caller asks again on its next
//! hover tick); the cache fills in behind the cursor.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::State;

use crate::mpv::{self, Mpv};

/// Thumbnail granularity. Finer buckets mean more captures while scrubbing but
/// previews that track the cursor closely; 2s matches the keyframe spacing of
/// typical web releases anyway.
const BUCKET_SECONDS: f64 = 2.0;
/// Decode/output width of the shadow chain (`vf=scale`); screenshots inherit it,
/// so no post-capture resize is ever needed.
const THUMB_WIDTH: u32 = 240;
const JPEG_QUALITY: u32 = 72;
/// How long a keyframe seek may take before the capture is abandoned (a live
/// torrent region that is not downloaded yet stalls exactly here).
const SEEK_SETTLE_MS: u64 = 4000;
const SETTLE_POLL: Duration = Duration::from_millis(25);

#[derive(Default)]
pub struct ThumbsState(Arc<Mutex<Inner>>);

#[derive(Default)]
struct Inner {
    /// The stream url thumbnails are being generated for. Changing it clears
    /// everything: cache keys are only meaningful per url.
    url: Option<String>,
    /// Monotonic generation counter; bumped on every url change so a capture
    /// finishing late cannot cache into the wrong stream's map.
    generation: u64,
    shadow: Option<Shadow>,
    cache: HashMap<u32, String>,
    /// The single pending bucket - latest hover wins.
    wanted: Option<u32>,
    worker_running: bool,
    /// After a failed shadow spawn (no dll / broken stream), stop retrying for
    /// this url; every later request would fail the same way.
    disabled: bool,
}

struct Shadow {
    mpv: Mpv,
}

impl Shadow {
    /// A windowless, muted, thumbnail-sized mpv over `url`. Options follow
    /// Harbor's shadow flags; `hr-seek=no` + keyframe seeks are the speed.
    fn spawn(url: &str) -> Result<Self, String> {
        let mpv = Mpv::load(&mpv::default_dll_path())?;
        for (name, value) in [
            ("vo", "null"),
            ("aid", "no"),
            ("sid", "no"),
            ("pause", "yes"),
            ("keep-open", "yes"),
            ("idle", "yes"),
            ("config", "no"),
            ("load-scripts", "no"),
            ("ytdl", "no"),
            ("osc", "no"),
            ("hwdec", "no"),
            ("cache", "yes"),
            ("demuxer-max-bytes", "32MiB"),
            ("hr-seek", "no"),
            ("vf", &format!("scale={THUMB_WIDTH}:-2")),
            ("screenshot-format", "jpg"),
            ("screenshot-jpeg-quality", &JPEG_QUALITY.to_string()),
            ("screenshot-high-bit-depth", "no"),
            ("screenshot-tag-colorspace", "no"),
        ] {
            // Options a given libmpv build lacks must not kill the feature.
            if let Err(e) = mpv.set_option(name, value) {
                tracing::debug!("thumbs: option {name}={value}: {e}");
            }
        }
        mpv.initialize()?;
        mpv.command(&["loadfile", url])?;
        Ok(Self { mpv })
    }

    /// Keyframe-seek to `target` and wait for the seek to settle. `false` on
    /// timeout (undownloaded torrent region / dead stream) - do not capture.
    fn seek_settled(&self, target: f64) -> bool {
        if self.mpv.command(&["seek", &format!("{target:.3}"), "absolute+keyframes"]).is_err() {
            return false;
        }
        let deadline = Instant::now() + Duration::from_millis(SEEK_SETTLE_MS);
        while Instant::now() < deadline {
            std::thread::sleep(SETTLE_POLL);
            match self.mpv.get_property_string("seeking").as_deref() {
                Some("no") => {
                    // A settled seek with no frame decoded yet reports no
                    // time-pos; require one so the screenshot has a frame.
                    if self.mpv.get_property_string("time-pos").is_some() {
                        return true;
                    }
                }
                // "yes" = still seeking; None = property gone (file replaced).
                Some(_) | None => {}
            }
        }
        false
    }

    /// Screenshot the current (already thumbnail-scaled) frame to a fresh temp
    /// jpg and return it as a data URL. Synchronous: on Ok the file exists.
    fn capture(&self) -> Result<String, String> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let temp = std::env::temp_dir().join(format!("rillio-thumb-{nanos}.jpg"));
        let path = temp.to_string_lossy().to_string();
        self.mpv
            .command(&["screenshot-to-file", &path, "video"])
            .map_err(|e| format!("thumbs: screenshot failed: {e}"))?;
        let bytes = std::fs::read(&temp).map_err(|e| format!("thumbs: reading {path}: {e}"))?;
        let _ = std::fs::remove_file(&temp);
        if bytes.is_empty() {
            return Err("thumbs: empty screenshot".into());
        }
        use base64::Engine as _;
        Ok(format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        ))
    }
}

/// Same rule as the player bridge's stream validation (shell.rs): the web layer
/// may only point the shadow at http(s), never local paths or mpv's pseudo
/// protocols (`av://`, `edl://`, ...) - those are exfil/execution vectors.
fn validate_url(url: &str) -> Result<(), String> {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Ok(())
    } else {
        Err(format!("thumbs: BLOCKED non-http(s) url: {url}"))
    }
}

/// One thumbnail request: `Some(dataUrl)` on a cache hit, `None` while the
/// worker generates (the web layer polls again on its next hover tick).
#[tauri::command]
pub async fn player_thumb(
    state: State<'_, ThumbsState>,
    url: String,
    time_sec: f64,
) -> Result<Option<String>, String> {
    if !time_sec.is_finite() || time_sec < 0.0 {
        return Ok(None);
    }
    validate_url(&url)?;
    let bucket = (time_sec / BUCKET_SECONDS).round() as u32;

    let inner_arc = state.0.clone();
    let mut inner = inner_arc.lock().map_err(|_| "thumbs: poisoned")?;
    if inner.url.as_deref() != Some(url.as_str()) {
        // New stream: drop the old shadow (its decoder pipeline is for the old
        // url) and every cached frame with it.
        inner.url = Some(url);
        inner.generation += 1;
        inner.shadow = None;
        inner.cache.clear();
        inner.wanted = None;
        inner.disabled = false;
    }
    if let Some(hit) = inner.cache.get(&bucket) {
        return Ok(Some(hit.clone()));
    }
    if inner.disabled {
        return Ok(None);
    }
    inner.wanted = Some(bucket);
    if !inner.worker_running {
        inner.worker_running = true;
        let arc = inner_arc.clone();
        // A dedicated OS thread: every step (mpv FFI, settle polling, file IO)
        // is blocking, and exactly one capture runs at a time.
        std::thread::spawn(move || worker(arc));
    }
    Ok(None)
}

/// Tear the shadow down (player unmount / playback stop). Frees the decoder
/// and closes the shadow's connection to the streaming server.
#[tauri::command]
pub async fn player_thumb_stop(state: State<'_, ThumbsState>) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "thumbs: poisoned")?;
    inner.url = None;
    inner.generation += 1;
    inner.shadow = None;
    inner.cache.clear();
    inner.wanted = None;
    inner.disabled = false;
    Ok(())
}

fn worker(inner_arc: Arc<Mutex<Inner>>) {
    loop {
        // Take the next job under the lock; NEVER hold the lock while driving
        // mpv (captures take up to seconds and player_thumb must stay instant).
        let (bucket, url, generation, shadow_missing) = {
            let mut inner = match inner_arc.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let Some(bucket) = inner.wanted.take() else {
                inner.worker_running = false;
                return;
            };
            if inner.cache.contains_key(&bucket) {
                continue;
            }
            let Some(url) = inner.url.clone() else {
                inner.worker_running = false;
                return;
            };
            (bucket, url, inner.generation, inner.shadow.is_none())
        };

        if shadow_missing {
            match Shadow::spawn(&url) {
                Ok(shadow) => {
                    let mut inner = match inner_arc.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    if inner.generation != generation {
                        // Url changed while spawning; the shadow is for the old
                        // stream. Drop it and loop for the new state.
                        continue;
                    }
                    inner.shadow = Some(shadow);
                }
                Err(e) => {
                    tracing::warn!("thumbs: shadow spawn failed: {e}");
                    let mut inner = match inner_arc.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    if inner.generation == generation {
                        inner.disabled = true;
                        inner.wanted = None;
                    }
                    inner.worker_running = false;
                    return;
                }
            }
        }

        // Drive the capture OUTSIDE the lock (it takes up to seconds, and
        // player_thumb must stay instant): take the shadow out under the lock,
        // capture, put it back. Ownership moves to this thread for the
        // duration, so a concurrent url change can only make the RESULT stale
        // (the generation check below discards it) - it never races the mpv.
        let taken = {
            let mut inner = match inner_arc.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if inner.generation != generation {
                continue;
            }
            inner.shadow.take()
        };
        let Some(shadow) = taken else { continue };
        let capture = if shadow.seek_settled(bucket as f64 * BUCKET_SECONDS) {
            shadow.capture()
        } else {
            Err("thumbs: seek did not settle (region not downloaded yet?)".into())
        };

        let mut inner = match inner_arc.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if inner.generation != generation {
            // Url changed mid-capture: the shadow and the frame belong to the
            // old stream; drop both.
            continue;
        }
        inner.shadow = Some(shadow);
        match capture {
            Ok(data_url) => {
                inner.cache.insert(bucket, data_url);
            }
            Err(e) => tracing::debug!("thumbs: bucket {bucket}: {e}"),
        }
    }
}
