//! Cache management API (Rillio-specific, not in the stremio server oracle):
//! list what's cached, keep ("download to cache" = add + pin), pin/unpin, and
//! delete. Backs the web app's Cached page and per-stream Download buttons.
//!
//! Trust model matches the rest of the server (see `security`): reads are GET,
//! every mutation is POST-only so a foreign page's `<img src>`/navigation (a
//! GET with no Origin) can never trigger one, and the Origin allowlist runs in
//! front of all of it.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use librqbit::TorrentStatsState;
use serde::{Deserialize, Serialize};

use crate::engine::Engine;
use crate::torrent::is_valid_infohash;

/// One cached torrent, as the Cached page renders it. Everything is scoped to
/// the SELECTED files (what we actually download), not the whole torrent, so a
/// season pack where one episode was picked shows that episode's name and size.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CacheEntry {
    pub info_hash: String,
    /// The playable file's name when the selection resolves to exactly one
    /// video (e.g. the episode filename), otherwise the torrent name.
    pub name: String,
    /// Bytes actually downloaded of the selected files (≈ on-disk weight).
    pub downloaded: u64,
    /// Total size of the selected files.
    pub total: u64,
    /// "initializing" | "live" | "paused" | "error".
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub pinned: bool,
    /// Whether the player marked this stream watched (streaming mode): an
    /// un-pinned watched entry is scheduled for automatic cleanup.
    pub watched: bool,
    /// Number of selected files.
    pub file_count: usize,
    /// The playable file's index in the torrent, when the selection contains
    /// exactly ONE video file; omitted for a season pack (ambiguous) or a
    /// selection with no video at all. Lets the Cached page build a player
    /// deep link for the entry.
    ///
    /// Deliberately NOT "exactly one selected file": scene releases routinely
    /// ship an .nfo/.txt/.jpg next to the video, and requiring a lone file made
    /// every one of those look unplayable (no Play button on a finished movie).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_idx: Option<usize>,
}

/// Extensions we treat as playable video. Matches the container formats the
/// player (libmpv) handles; anything else in a torrent (.nfo, .txt, .jpg,
/// .srt, sample scripts) is packaging, not the thing the user wants to watch.
const VIDEO_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "avi", "mov", "m4v", "webm", "ts", "m2ts", "mts", "wmv", "flv", "mpg", "mpeg",
    "ogv", "ogm", "divx", "vob", "rmvb", "3gp",
];

fn is_video(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(_, ext)| VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
}

/// `GET /cache/list` - every torrent the engine manages (the session persists
/// across restarts, so this is the whole cache), biggest first.
pub(crate) async fn list(State(engine): State<Engine>) -> Json<Vec<CacheEntry>> {
    let mut entries: Vec<CacheEntry> = engine
        .all()
        .iter()
        .map(|handle| {
            let stats = handle.stats();
            let info_hash = Engine::info_hash_hex(handle);
            let files = Engine::files(handle);
            // The download selection: `only_files() == None` means every file.
            // Indices are bounds-checked so a stale selection can't panic.
            let selected: Vec<usize> = match handle.only_files() {
                Some(only) => only.into_iter().filter(|&i| i < files.len()).collect(),
                None => (0..files.len()).collect(),
            };
            let total: u64 = selected.iter().map(|&i| files[i].length).sum();
            // Per-file have-bytes are exact (never exceed the file's length),
            // unlike `progress_bytes` which is piece-aligned.
            //
            // `progress_bytes` MEANS DIFFERENT THINGS PER STATE, and conflating
            // them is a bug we shipped: for Live/Paused it is have-bytes, but for
            // Initializing librqbit sets it to `checked_bytes` - how far the HASH
            // CHECK has scanned, which is not data we hold. Since file_progress is
            // also empty while initializing (no chunk tracker yet), the old
            // `file_progress.is_empty() -> progress_bytes` fallback reported the
            // check's scan as downloaded: on a freshly preallocated file the row
            // raced to ~total in seconds (checking zeros is fast) and then
            // COLLAPSED to 0 the moment it went live and the truth took over.
            // Every pause/resume re-runs the check, so it climbed and collapsed
            // again. There is no have-byte count during Initializing, so the
            // honest answer is 0; the row already says "Preparing" there.
            let downloaded: u64 = match stats.state {
                TorrentStatsState::Initializing | TorrentStatsState::Error => 0,
                TorrentStatsState::Live | TorrentStatsState::Paused => {
                    if stats.file_progress.is_empty() {
                        // Live can still yield an empty vec if the chunk-tracker read
                        // fails; there progress_bytes IS have-bytes, so it stands in.
                        // Clamped so `downloaded <= total` always holds.
                        stats.progress_bytes.min(total)
                    } else {
                        selected
                            .iter()
                            .map(|&i| stats.file_progress.get(i).copied().unwrap_or(0))
                            .sum()
                    }
                }
            };
            // The playable file: the lone video among the selected files. A
            // season pack (many videos) stays ambiguous, and a selection with
            // no video at all is not playable.
            let videos: Vec<usize> = selected
                .iter()
                .copied()
                .filter(|&i| is_video(&files[i].name))
                .collect();
            let playable = if videos.len() == 1 { Some(videos[0]) } else { None };
            let name = match playable {
                Some(idx) => files[idx].name.clone(),
                None => handle.name().unwrap_or_default(),
            };
            CacheEntry {
                pinned: engine.is_pinned(&info_hash),
                watched: engine.is_watched(&info_hash),
                info_hash,
                name,
                downloaded,
                total,
                state: format!("{:?}", stats.state).to_lowercase(),
                error: stats.error.clone(),
                file_count: selected.len(),
                file_idx: playable,
            }
        })
        .collect();
    entries.sort_by(|a, b| b.downloaded.cmp(&a.downloaded));
    Json(entries)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadBody {
    info_hash: String,
    /// Optional: ensure this file is part of the download selection (a stream
    /// row knows which file it points at).
    file_idx: Option<usize>,
}

/// `POST /cache/download` - "download to cache": add-or-get the torrent, make
/// sure it is running and the requested file is selected, and PIN it so the
/// cache sweeper never evicts it.
pub(crate) async fn download(
    State(engine): State<Engine>,
    Json(body): Json<DownloadBody>,
) -> Response {
    if !is_valid_infohash(&body.info_hash) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let info_hash = body.info_hash.to_lowercase();
    let handle = match engine.get_or_create(&info_hash).await {
        Ok(h) => h,
        Err(e) => {
            tracing::error!("cache/download add failed: {e:#}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    if let Some(idx) = body.file_idx {
        engine.select_file(&handle, idx).await;
    }
    // A fresh add is already unpaused and still initializing, which librqbit
    // reports as "not paused" - so this is a no-op there and only does work when
    // re-downloading something the user had paused. Not fatal either way: the
    // torrent is added and pinned, which is what the caller asked for.
    if let Err(e) = engine.unpause(&handle).await {
        tracing::warn!("cache/download {info_hash}: {e:#}");
    }
    engine.touch(&info_hash);
    engine.set_pinned(&info_hash, true);
    Json(serde_json::json!({ "success": true })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PinBody {
    info_hash: String,
    pinned: bool,
}

/// `POST /cache/pin` - toggle eviction protection.
pub(crate) async fn pin(State(engine): State<Engine>, Json(body): Json<PinBody>) -> Response {
    if !is_valid_infohash(&body.info_hash) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    engine.set_pinned(&body.info_hash.to_lowercase(), body.pinned);
    Json(serde_json::json!({ "success": true })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WatchedBody {
    info_hash: String,
    watched: bool,
}

/// `POST /cache/watched` - the player reporting a stream watched (>= ~90%
/// through). In streaming mode the ephemeral sweeper deletes un-pinned watched
/// torrents after a grace period; a pinned ("kept") torrent keeps the mark but
/// is never deleted.
pub(crate) async fn watched(State(engine): State<Engine>, Json(body): Json<WatchedBody>) -> Response {
    if !is_valid_infohash(&body.info_hash) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    engine.set_watched(&body.info_hash.to_lowercase(), body.watched);
    Json(serde_json::json!({ "success": true })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PauseBody {
    info_hash: String,
    paused: bool,
}

/// `POST /cache/pause` - pause or resume a cached torrent's download.
pub(crate) async fn pause(State(engine): State<Engine>, Json(body): Json<PauseBody>) -> Response {
    if !is_valid_infohash(&body.info_hash) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let info_hash = body.info_hash.to_lowercase();
    let Some(handle) = engine.get(&info_hash) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let result = if body.paused {
        engine.pause(&handle).await
    } else {
        engine.unpause(&handle).await
    };
    // A refused pause must not answer {"success": true}. librqbit cannot pause a
    // torrent mid-hash-check, and swallowing that told the UI the row was paused
    // while the download ran on. 409: the request was fine, the torrent's state
    // would not allow it.
    match result {
        Ok(()) => Json(serde_json::json!({ "success": true })).into_response(),
        Err(e) => {
            tracing::warn!("cache/pause {} paused={}: {e:#}", info_hash, body.paused);
            (
                StatusCode::CONFLICT,
                Json(serde_json::json!({ "error": format!("{e:#}") })),
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteBody {
    info_hash: String,
}

/// `POST /cache/delete` - stop the torrent and delete its cached files.
pub(crate) async fn delete(State(engine): State<Engine>, Json(body): Json<DeleteBody>) -> Response {
    if !is_valid_infohash(&body.info_hash) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    engine.remove(&body.info_hash.to_lowercase()).await;
    Json(serde_json::json!({ "success": true })).into_response()
}
