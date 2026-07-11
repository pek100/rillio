//! Auditable Rust replacement for the Stremio streaming server (`server.js`).
//!
//! Library-first: [`router`] returns an [`axum::Router`] the eventual native
//! host mounts in-process. [`serve`] is a convenience for the standalone bin
//! and for the oracle-diff tests.
//!
//! Milestone status lives in `docs/streaming-server-rust/` and
//! `checklists/streaming-server-rust.md`. This is **M0** - the control plane.

mod hlsv2;
mod local_addon;
mod proxy;
mod routes;
mod security;
mod ssrf;
mod stats;
mod stream;
mod support;
mod torrent;

pub mod config;
pub mod engine;
pub mod storage;
pub mod types;

pub use config::Config;
pub use engine::Engine;

use std::time::Duration;

use axum::extract::FromRef;
use axum::routing::{any, get, on, post, MethodFilter};
use axum::Router;

/// Shared router state. `FromRef` lets control-plane handlers extract
/// `State<Config>` and torrent handlers extract `State<Engine>` from the same
/// state without either knowing about the other. Outbound HTTP clients are built
/// per-request, pinned to a vetted IP (see [`ssrf`]), so no client lives here.
#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub engine: Engine,
}

impl FromRef<AppState> for Config {
    fn from_ref(s: &AppState) -> Config {
        s.config.clone()
    }
}
impl FromRef<AppState> for Engine {
    fn from_ref(s: &AppState) -> Engine {
        s.engine.clone()
    }
}

/// Build the streaming-server router.
///
/// The socket binds loopback, but that alone does not stop other browsers on the
/// machine from reaching it, so the web-origin trust boundary is enforced here:
/// an Origin allowlist (see [`security`]) rejects real websites while allowing the
/// Tauri webview and no-Origin media/native loads, and every state-changing route
/// is POST-only. Do not bind this to a public interface.
pub fn router(config: Config, engine: Engine) -> Router {
    let state = AppState { config, engine };
    Router::new()
        // M0 control plane
        .route("/settings", get(routes::get_settings).post(routes::post_settings))
        // Rillio-specific torrent prefs (the "faster downloads" toggle). Kept off
        // the Stremio-schema /settings so its oracle diff stays clean.
        .route(
            "/torrent-settings",
            get(routes::get_torrent_settings).post(routes::post_torrent_settings),
        )
        .route("/network-info", get(routes::network_info))
        .route("/device-info", get(routes::device_info))
        .route("/casting", get(routes::casting))
        .route("/casting/", get(routes::casting))
        .route("/heartbeat", get(routes::heartbeat))
        .route("/", get(routes::root))
        .route("/favicon.ico", get(routes::favicon))
        // M1 torrent engine. POST-only: these mutate state, so they must not be
        // reachable from a foreign page's `<img src>` / navigation (a GET with no
        // Origin). The web client + core already POST create; nothing issues remove.
        .route("/create", post(torrent::create_blob))
        .route("/{info_hash}/create", post(torrent::create_magnet))
        .route("/removeAll", post(torrent::remove_all))
        .route("/{info_hash}/remove", post(torrent::remove))
        // M2 stats family (static segments; win over the {idx} stream param).
        .route("/stats.json", get(stats::stats_aggregate))
        .route("/{info_hash}/stats.json", get(stats::stats_torrent))
        .route("/{info_hash}/{idx}/stats.json", get(stats::stats_file))
        // M3a header-injecting media proxy + HLS playlist rewriter (all methods).
        .route("/proxy/{opts}", any(proxy::proxy_root))
        .route("/proxy/{opts}/{*path}", any(proxy::proxy_with_path))
        // M3b support routes.
        .route("/opensubHash", get(support::opensub_hash))
        .route("/subtitles.vtt", get(support::subtitles_vtt))
        .route("/subtitles.srt", get(support::subtitles_srt))
        .route("/subtitlesTracks", get(support::subtitles_tracks))
        .route("/tracks/{url}", get(support::tracks))
        .route("/yt/{id}", get(support::yt))
        // /hlsv2/probe - report direct-playable so the player uses the direct
        // stream URL (mpv shell: no server transcode). Rest of /hlsv2 deferred.
        .route("/hlsv2/probe", get(hlsv2::probe))
        // M4 local-files addon transport (manifest so core recognizes it;
        // resources return empty - full indexing deferred).
        .route("/local-addon/manifest.json", get(local_addon::local_manifest))
        .route("/local-addon/{resource}/{type}/{*rest}", get(local_addon::local_resource))
        // The media stream. GET+HEAD are handled explicitly (HEAD must not open
        // the FileStream), so we register both methods on one handler rather
        // than let axum synthesize HEAD from GET.
        .route(
            "/{info_hash}/{idx}",
            on(MethodFilter::GET.or(MethodFilter::HEAD), stream::stream),
        )
        .route(
            "/{info_hash}/{idx}/{*rest}",
            on(MethodFilter::GET.or(MethodFilter::HEAD), stream::stream_rest),
        )
        // Innermost: request logging. Middle: CORS (echoes ACAO for the allowlisted
        // webview + answers its Private Network Access preflight). Outermost: the
        // origin guard, so a foreign Origin is rejected before CORS or any handler.
        .layer(axum::middleware::from_fn(log_request))
        .layer(security::cors_layer())
        .layer(axum::middleware::from_fn(security::origin_guard))
        .with_state(state)
}

/// Log every incoming request (method + path + Origin). Diagnostic; cheap enough
/// to keep. The Origin is logged so the trusted webview origin can be confirmed
/// against the allowlist in [`security`] without guessing.
async fn log_request(req: axum::extract::Request, next: axum::middleware::Next) -> axum::response::Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let origin = req
        .headers()
        .get(axum::http::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<none>")
        .to_owned();
    tracing::debug!("REQ {method} {uri} Origin={origin}");
    next.run(req).await
}

/// Bind `config.bind` and serve until the process is signalled. Builds the
/// engine from `config.cache_root`. Embedders build their own [`Engine`],
/// call [`router`], and drive their own server.
pub async fn serve(config: Config) -> std::io::Result<()> {
    let bind = config.bind;
    let engine = Engine::new(config.cache_root.clone())
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    spawn_cache_sweeper(&config, engine.clone());
    let app = router(config, engine);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "streaming server listening");
    axum::serve(listener, app).await
}

/// How often the cache sweeper checks disk usage.
const CACHE_SWEEP_INTERVAL: Duration = Duration::from_secs(30);
/// A torrent touched (streamed/queried) within this window is never evicted, so
/// whatever is currently playing is protected from the cache cap.
const CACHE_EVICT_GRACE: Duration = Duration::from_secs(120);

/// Enforce `config.cache_size` (S7): periodically evict the least-recently-used
/// idle torrents when the cache exceeds the cap. `None` cacheSize = unlimited (no
/// sweeper). A streaming server plays a *window* of a torrent, so adds are never
/// refused by size (see `tests/confinement.rs`); the bound is applied here, after
/// the fact, by eviction rather than refusal.
fn spawn_cache_sweeper(config: &Config, engine: Engine) {
    let Some(cap) = config.cache_size else {
        tracing::info!("cache-cap: unlimited (no cacheSize); disk growth is unbounded");
        return;
    };
    let cap = cap.max(0.0) as u64;
    tracing::info!("cache-cap: enforcing ~{cap} bytes by evicting idle torrents");
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(CACHE_SWEEP_INTERVAL);
        loop {
            tick.tick().await;
            engine.enforce_cache_cap(cap, CACHE_EVICT_GRACE).await;
        }
    });
}
