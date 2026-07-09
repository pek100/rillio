//! Auditable Rust replacement for the Stremio streaming server (`server.js`).
//!
//! Library-first: [`router`] returns an [`axum::Router`] the eventual native
//! host mounts in-process. [`serve`] is a convenience for the standalone bin
//! and for the oracle-diff tests.
//!
//! Milestone status lives in `docs/streaming-server-rust/` and
//! `checklists/streaming-server-rust.md`. This is **M0** — the control plane.

mod hlsv2;
mod local_addon;
mod proxy;
mod routes;
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

use axum::extract::FromRef;
use axum::routing::{any, get, on, post, MethodFilter};
use axum::Router;
use tower_http::cors::CorsLayer;

/// Shared router state. `FromRef` lets control-plane handlers extract
/// `State<Config>` and torrent handlers extract `State<Engine>` from the same
/// state without either knowing about the other.
#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub engine: Engine,
    /// Shared outbound HTTP client for `/proxy` (manual redirects; TLS verified).
    pub http: reqwest::Client,
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
impl FromRef<AppState> for reqwest::Client {
    fn from_ref(s: &AppState) -> reqwest::Client {
        s.http.clone()
    }
}

/// Build the streaming-server router.
///
/// CORS is permissive (`Access-Control-Allow-Origin: *`) to match the
/// container's `NO_CORS=1` behavior — safe only because the socket is expected
/// to bind loopback. Do not bind this to a public interface.
pub fn router(config: Config, engine: Engine) -> Router {
    // Manual redirect handling so the proxy's SSRF guard runs on every hop.
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("reqwest client");
    let state = AppState { config, engine, http };
    Router::new()
        // M0 control plane
        .route("/settings", get(routes::get_settings).post(routes::post_settings))
        .route("/network-info", get(routes::network_info))
        .route("/device-info", get(routes::device_info))
        .route("/casting", get(routes::casting))
        .route("/casting/", get(routes::casting))
        .route("/heartbeat", get(routes::heartbeat))
        .route("/", get(routes::root))
        .route("/favicon.ico", get(routes::favicon))
        // M1 torrent engine
        .route("/create", post(torrent::create_blob).get(torrent::create_blob))
        .route(
            "/{info_hash}/create",
            post(torrent::create_magnet).get(torrent::create_magnet),
        )
        .route("/removeAll", get(torrent::remove_all))
        .route("/{info_hash}/remove", get(torrent::remove))
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
        // /hlsv2/probe — report direct-playable so the player uses the direct
        // stream URL (mpv shell: no server transcode). Rest of /hlsv2 deferred.
        .route("/hlsv2/probe", get(hlsv2::probe))
        // M4 local-files addon transport (manifest so core recognizes it;
        // resources return empty — full indexing deferred).
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
        .layer(axum::middleware::from_fn(log_request))
        // Permissive CORS + Private Network Access: a WebView/browser page served
        // from a non-loopback-classified origin (e.g. tauri.localhost) fetching
        // this loopback server triggers Chromium's PNA preflight, which requires
        // `Access-Control-Allow-Private-Network: true`. Without it the fetch is
        // blocked before it reaches us. Safe because we bind loopback only.
        .layer(CorsLayer::permissive().allow_private_network(true))
        .with_state(state)
}

/// Log every incoming request (method + path). Diagnostic; cheap enough to keep.
async fn log_request(req: axum::extract::Request, next: axum::middleware::Next) -> axum::response::Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    tracing::debug!("REQ {method} {uri}");
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
    let app = router(config, engine);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "streaming server listening");
    axum::serve(listener, app).await
}
