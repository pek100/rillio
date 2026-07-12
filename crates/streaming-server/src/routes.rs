//! M0 control-plane handlers. No torrent engine, no ffmpeg.

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Redirect};
use axum::Json;

use crate::config::Config;
use crate::engine::{self, BtProfile, Engine};
use crate::types::{
    DeviceInfo, NetworkInfo, SettingsOption, SettingsResponse, SettingsSelection, SettingsValues,
    Success, TorrentSettings,
};
use serde::Deserialize;

/// Web UI the bare `/` redirects to, matching the container's behavior.
const WEB_UI_LOCATION: &str = "https://app.strem.io/shell-v4.4/";

const TRANSCODE_HORSEPOWER: f64 = 0.75;
const TRANSCODE_MAX_WIDTH: u64 = 1920;

pub async fn get_settings(
    State(cfg): State<Config>,
    State(engine): State<Engine>,
) -> Json<SettingsResponse> {
    let cache_root = cfg.cache_root.display().to_string();
    let app_path = cfg.app_path.display().to_string();

    // The BitTorrent knobs are live state (the torrent-profile selector drives
    // them via POST /settings), so they come from the engine, not fixed consts.
    let bt = engine.bt_profile();

    let values = SettingsValues {
        server_version: cfg.server_version.clone(),
        app_path,
        cache_root,
        cache_size: cfg.cache_size,
        bt_max_connections: bt.max_connections,
        bt_handshake_timeout: bt.handshake_timeout,
        bt_request_timeout: bt.request_timeout,
        bt_download_speed_soft_limit: bt.download_speed_soft_limit,
        bt_download_speed_hard_limit: bt.download_speed_hard_limit,
        bt_min_peers_for_stable: bt.min_peers_for_stable,
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

/// The BitTorrent fields of the client's `POST /settings` body (the torrent
/// profile selector). Every field is optional so a partial or differently
/// shaped body merges over the current profile instead of zeroing it, and all
/// the non-BT fields core also sends (cacheSize, transcode, ...) are ignored.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SettingsPatch {
    bt_max_connections: Option<u64>,
    bt_handshake_timeout: Option<u64>,
    bt_request_timeout: Option<u64>,
    bt_download_speed_soft_limit: Option<f64>,
    bt_download_speed_hard_limit: Option<f64>,
    bt_min_peers_for_stable: Option<u64>,
}

/// POST `/settings` - the client persists user changes here. We apply the
/// BitTorrent profile live: the download HARD limit becomes the session-wide
/// download cap immediately, the rest is stored for reporting (see
/// [`Engine::apply_bt_profile`]). cacheSize/transcode remain deferred. A body
/// that fails to parse is ignored (still acked) so the contract never 4xx's.
pub async fn post_settings(State(engine): State<Engine>, body: axum::body::Bytes) -> Json<Success> {
    if let Ok(patch) = serde_json::from_slice::<SettingsPatch>(&body) {
        let cur = engine.bt_profile();
        engine.apply_bt_profile(BtProfile {
            max_connections: patch.bt_max_connections.unwrap_or(cur.max_connections),
            handshake_timeout: patch.bt_handshake_timeout.unwrap_or(cur.handshake_timeout),
            request_timeout: patch.bt_request_timeout.unwrap_or(cur.request_timeout),
            download_speed_soft_limit: patch
                .bt_download_speed_soft_limit
                .unwrap_or(cur.download_speed_soft_limit),
            download_speed_hard_limit: patch
                .bt_download_speed_hard_limit
                .unwrap_or(cur.download_speed_hard_limit),
            min_peers_for_stable: patch.bt_min_peers_for_stable.unwrap_or(cur.min_peers_for_stable),
        });
    }
    Json(Success::ok())
}

/// GET `/torrent-settings` - the persisted "faster downloads" (inbound listen
/// port + UPnP) preference. Rillio-specific; the UI reflects this toggle and
/// notes that a change applies on the next app start.
pub async fn get_torrent_settings(State(cfg): State<Config>) -> Json<TorrentSettings> {
    Json(TorrentSettings {
        listen_enabled: engine::read_listen_pref(&cfg.cache_root),
    })
}

/// POST `/torrent-settings` - persist the toggle. Written to the cache root the
/// engine reads at startup; it does NOT reconfigure the live session (librqbit
/// fixes the listener at construction), so it takes effect on the next launch.
pub async fn post_torrent_settings(
    State(cfg): State<Config>,
    Json(body): Json<TorrentSettings>,
) -> impl IntoResponse {
    match engine::write_listen_pref(&cfg.cache_root, body.listen_enabled) {
        Ok(()) => (StatusCode::OK, Json(Success::ok())),
        Err(e) => {
            tracing::error!("failed to persist torrent settings: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(Success { success: false }))
        }
    }
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

/// `GET /casting` - core probes this on load and tolerates failure. An empty
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
