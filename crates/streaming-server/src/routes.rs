//! M0 control-plane handlers. No torrent engine, no ffmpeg.

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Redirect};
use axum::Json;

use crate::config::Config;
use crate::types::{
    DeviceInfo, NetworkInfo, SettingsOption, SettingsResponse, SettingsSelection, SettingsValues,
    Success,
};

/// Web UI the bare `/` redirects to, matching the container's behavior.
const WEB_UI_LOCATION: &str = "https://app.strem.io/shell-v4.4/";

// BitTorrent + transcode constants mirrored from the reference container's
// `/settings.values`. They become real config in later milestones (M1 engine,
// M6 transcode); for M0 they are fixed so the oracle diff is clean.
const BT_MAX_CONNECTIONS: u64 = 55;
const BT_HANDSHAKE_TIMEOUT: u64 = 20_000;
const BT_REQUEST_TIMEOUT: u64 = 4_000;
const BT_DOWNLOAD_SPEED_SOFT_LIMIT: u64 = 2_621_440;
const BT_DOWNLOAD_SPEED_HARD_LIMIT: u64 = 3_670_016;
const BT_MIN_PEERS_FOR_STABLE: u64 = 5;
const TRANSCODE_HORSEPOWER: f64 = 0.75;
const TRANSCODE_MAX_WIDTH: u64 = 1920;

pub async fn get_settings(State(cfg): State<Config>) -> Json<SettingsResponse> {
    let cache_root = cfg.cache_root.display().to_string();
    let app_path = cfg.app_path.display().to_string();

    let values = SettingsValues {
        server_version: cfg.server_version.clone(),
        app_path,
        cache_root,
        cache_size: cfg.cache_size,
        bt_max_connections: BT_MAX_CONNECTIONS,
        bt_handshake_timeout: BT_HANDSHAKE_TIMEOUT,
        bt_request_timeout: BT_REQUEST_TIMEOUT,
        bt_download_speed_soft_limit: BT_DOWNLOAD_SPEED_SOFT_LIMIT,
        bt_download_speed_hard_limit: BT_DOWNLOAD_SPEED_HARD_LIMIT,
        bt_min_peers_for_stable: BT_MIN_PEERS_FOR_STABLE,
        // Must be "" not null (core's empty_string_as_null).
        remote_https: String::new(),
        local_addon_enabled: false,
        transcode_horsepower: TRANSCODE_HORSEPOWER,
        transcode_max_bit_rate: 0,
        transcode_concurrency: 1,
        transcode_track_concurrency: 1,
        transcode_hardware_accel: false,
        transcode_profile: None,
        all_transcode_profiles: vec![],
        transcode_max_width: TRANSCODE_MAX_WIDTH,
        proxy_streams_enabled: false,
    };

    Json(SettingsResponse {
        options: settings_options(&cfg),
        values,
        base_url: cfg.base_url.as_str().trim_end_matches('/').to_owned(),
    })
}

/// POST `/settings` — the client persists user changes here. M0 acknowledges
/// without storing; real persistence lands with the engine (M1/M2) that
/// actually consumes cacheSize/limits.
pub async fn post_settings() -> Json<Success> {
    Json(Success::ok())
}

pub async fn network_info() -> Json<NetworkInfo> {
    // Interface enumeration feeds the remote-HTTPS feature, which is out of M0
    // scope. Empty is a valid, safe answer; real enumeration is a later add.
    Json(NetworkInfo {
        available_interfaces: vec![],
    })
}

pub async fn device_info() -> Json<DeviceInfo> {
    // `false` matches the container when no hwaccel is probed (M6 does the real
    // probe). core's DefaultOnError maps it to an empty list.
    Json(DeviceInfo {
        available_hardware_accelerations: serde_json::Value::Bool(false),
    })
}

/// `GET /casting` — core probes this on load and tolerates failure. An empty
/// list is the safe stub. (Our reference container returns 404 only because it
/// runs with CASTING_DISABLED=1; core handles both.)
pub async fn casting() -> Json<Vec<serde_json::Value>> {
    Json(vec![])
}

pub async fn heartbeat() -> Json<Success> {
    Json(Success::ok())
}

pub async fn root() -> Redirect {
    Redirect::temporary(WEB_UI_LOCATION)
}

pub async fn favicon() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, [(header::CONTENT_TYPE, "text/plain")], "")
}

fn settings_options(cfg: &Config) -> Vec<SettingsOption> {
    vec![
        SettingsOption {
            id: "localAddonEnabled",
            label: "ENABLE_LOCAL_FILES_ADDON",
            kind: "checkbox",
            class: None,
            icon: None,
            selections: vec![],
        },
        SettingsOption {
            id: "remoteHttps",
            label: "ENABLE_REMOTE_HTTPS_CONN",
            kind: "select",
            class: Some("https"),
            icon: Some(true),
            selections: vec![SettingsSelection {
                name: "Disabled".to_owned(),
                val: serde_json::Value::String(String::new()),
            }],
        },
        SettingsOption {
            id: "cacheSize",
            label: "CACHING",
            kind: "select",
            class: Some("caching"),
            icon: Some(true),
            selections: cache_size_selections(cfg),
        },
    ]
}

fn cache_size_selections(_cfg: &Config) -> Vec<SettingsSelection> {
    let mk = |name: &str, val: serde_json::Value| SettingsSelection {
        name: name.to_owned(),
        val,
    };
    vec![
        mk("no caching", serde_json::json!(0)),
        mk("2GB", serde_json::json!(2_147_483_648u64)),
        mk("5GB", serde_json::json!(5_368_709_120u64)),
        mk("10GB", serde_json::json!(10_737_418_240u64)),
        mk("\u{221e}", serde_json::Value::Null),
    ]
}
