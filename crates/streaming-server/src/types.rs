//! Response bodies. Field names and shapes mirror what `crates/core` and
//! `packages/video` deserialize; verified against the reference container and
//! `crates/core/src/types/streaming_server/`.

use serde::{Deserialize, Serialize};

/// `GET /settings` - the master endpoint. If core cannot deserialize this, its
/// whole streaming-server model cascades to "server down"
/// (streaming_server.rs:293-315), so every required field must be present.
#[derive(Serialize)]
pub struct SettingsResponse {
    pub options: Vec<SettingsOption>,
    pub values: SettingsValues,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
}

#[derive(Serialize)]
pub struct SettingsOption {
    pub id: &'static str,
    pub label: &'static str,
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub selections: Vec<SettingsSelection>,
}

#[derive(Serialize)]
pub struct SettingsSelection {
    pub name: String,
    pub val: serde_json::Value,
}

/// The `values` object. Core's `Settings` struct
/// (types/streaming_server/settings.rs) reads a subset; the rest match the
/// container so an oracle diff on the fixed fields is clean. `remoteHttps` MUST
/// serialize as `""` not `null` (core's `empty_string_as_null`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsValues {
    pub server_version: String,
    pub app_path: String,
    pub cache_root: String,
    pub cache_size: Option<f64>,
    pub bt_max_connections: u64,
    pub bt_handshake_timeout: u64,
    pub bt_request_timeout: u64,
    // f64 (not u64): core reads these as f64 and the "soft" profile uses a
    // fractional B/s value, so u64 truncation would make the UI show "custom".
    pub bt_download_speed_soft_limit: f64,
    pub bt_download_speed_hard_limit: f64,
    pub bt_min_peers_for_stable: u64,
    pub remote_https: String,
    pub local_addon_enabled: bool,
    pub transcode_horsepower: f64,
    pub transcode_max_bit_rate: u64,
    pub transcode_concurrency: u64,
    pub transcode_track_concurrency: u64,
    pub transcode_hardware_accel: bool,
    pub transcode_profile: Option<String>,
    pub all_transcode_profiles: Vec<serde_json::Value>,
    pub transcode_max_width: u64,
    pub proxy_streams_enabled: bool,
}

/// `GET /network-info` - `{availableInterfaces:[...]}` (non-internal IPv4).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub available_interfaces: Vec<String>,
}

/// `GET /device-info`. The container returns `false` (not `[]`) when no
/// hardware acceleration is probed; core's `DefaultOnError` accepts either, so
/// we emit `false` to match the oracle byte-for-byte. Real hwaccel probing is
/// deferred to M6.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub available_hardware_accelerations: serde_json::Value,
}

/// `{success:true}` - used by POST `/settings` and `/heartbeat`.
#[derive(Serialize)]
pub struct Success {
    pub success: bool,
}

impl Success {
    pub fn ok() -> Self {
        Self { success: true }
    }
}

/// Body of `GET`/`POST /torrent-settings` - Rillio-specific (not part of the
/// Stremio `/settings` schema, so it stays out of that oracle-diffed response).
/// `listenEnabled` opts the torrent engine into an inbound listen port + UPnP
/// ("faster downloads", at the cost of being a discoverable seeder). The engine
/// reads it only at startup, so a change takes effect on the next launch.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentSettings {
    pub listen_enabled: bool,
}

// ---------------------------------------------------------------------------
// getStatistics (M1 create responses; shared with M2 stats routes).
// Field names/types mirror crates/core/src/types/streaming_server/statistics.rs
// EXACTLY - every field is required there (no serde defaults), so an omission
// makes core's `Option<Statistics>` deserialize to None (silent "no stats").
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub name: String,
    pub path: String,
    pub length: u64,
    pub offset: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Growler {
    pub flood: u64,
    pub pulse: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerSearch {
    pub max: u64,
    pub min: u64,
    pub sources: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SwarmCap {
    pub max_speed: Option<f64>,
    pub min_peers: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub connections: Option<u64>,
    pub dht: bool,
    pub growler: Growler,
    pub handshake_timeout: Option<u64>,
    pub path: String,
    pub peer_search: PeerSearch,
    pub swarm_cap: SwarmCap,
    pub timeout: Option<u64>,
    pub tracker: bool,
    pub r#virtual: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub name: String,
    pub info_hash: String,
    pub files: Vec<File>,
    pub sources: Vec<serde_json::Value>,
    pub opts: Options,
    pub download_speed: f64,
    pub upload_speed: f64,
    pub downloaded: u64,
    pub uploaded: u64,
    pub unchoked: u64,
    pub peers: u64,
    pub queued: u64,
    pub unique: u64,
    pub connection_tries: u64,
    pub peer_search_running: bool,
    pub stream_len: u64,
    pub stream_name: String,
    pub stream_progress: f64,
    pub swarm_connections: u64,
    pub swarm_paused: bool,
    pub swarm_size: u64,
    // Rillio extensions (absent from the stremio server oracle; core ignores
    // unknown fields): the engine's torrent state and failure message, so the
    // player can tell the user WHY a stream failed (disk full, paused after a
    // write error, ...) instead of a bare 500.
    pub engine_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine_error: Option<String>,
}

/// Create-route response: the full statistics object plus `guessedFileIdx`,
/// which video reads (createTorrent.js:68) and is not part of `Statistics`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResponse {
    #[serde(flatten)]
    pub statistics: Statistics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guessed_file_idx: Option<i64>,
}
