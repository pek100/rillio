//! Response bodies. Field names and shapes mirror what `crates/core` and
//! `packages/video` deserialize; verified against the reference container and
//! `crates/core/src/types/streaming_server/`.

use serde::Serialize;

/// `GET /settings` — the master endpoint. If core cannot deserialize this, its
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
    pub bt_download_speed_soft_limit: u64,
    pub bt_download_speed_hard_limit: u64,
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

/// `GET /network-info` — `{availableInterfaces:[...]}` (non-internal IPv4).
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

/// `{success:true}` — used by POST `/settings` and `/heartbeat`.
#[derive(Serialize)]
pub struct Success {
    pub success: bool,
}

impl Success {
    pub fn ok() -> Self {
        Self { success: true }
    }
}
