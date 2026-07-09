//! `/hlsv2/probe` — playability probe (partial M6).
//!
//! This is an mpv-based shell: mpv decodes every codec, so we never transcode.
//! The web client's `canPlayStream` (packages/video withStreamingServer.js:360)
//! probes `/hlsv2/probe` to decide direct-play vs transcode; if the probe fails
//! it routes to the transcode path (`/hlsv2/master.m3u8`), which we do not
//! implement. So the probe reports the media as **directly playable**, routing
//! the player to the direct stream URL `/{ih}/{idx}` — which auto-creates the
//! torrent and starts the download. Real ffprobe-based probing and the transcode
//! pipeline remain deferred (mpv makes them unnecessary for the desktop shell).

use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// `GET /hlsv2/probe?mediaURL=…` → a format/streams report that
/// `canPlayStream` accepts as directly playable (format + codecs the client
/// supports, one audio track, no embedded subtitles).
pub(crate) async fn probe() -> Response {
    Json(json!({
        "format": { "name": "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm" },
        "streams": [
            { "track": "video", "codec": "h264" },
            { "track": "audio", "codec": "aac", "channels": 2 }
        ]
    }))
    .into_response()
}
