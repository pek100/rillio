//! Auditable Rust replacement for the Stremio streaming server (`server.js`).
//!
//! Library-first: [`router`] returns an [`axum::Router`] the eventual native
//! host mounts in-process. [`serve`] is a convenience for the standalone bin
//! and for the oracle-diff tests.
//!
//! Milestone status lives in `docs/streaming-server-rust/` and
//! `checklists/streaming-server-rust.md`. This is **M0** — the control plane.

mod routes;
mod stats;
mod stream;
mod torrent;

pub mod config;
pub mod engine;
pub mod storage;
pub mod types;

pub use config::Config;
pub use engine::Engine;

use axum::extract::FromRef;
use axum::routing::{get, on, post, MethodFilter};
use axum::Router;
use tower_http::cors::CorsLayer;

/// Shared router state. `FromRef` lets control-plane handlers extract
/// `State<Config>` and torrent handlers extract `State<Engine>` from the same
/// state without either knowing about the other.
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
/// CORS is permissive (`Access-Control-Allow-Origin: *`) to match the
/// container's `NO_CORS=1` behavior — safe only because the socket is expected
/// to bind loopback. Do not bind this to a public interface.
pub fn router(config: Config, engine: Engine) -> Router {
    let state = AppState { config, engine };
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
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Bind `config.bind` and serve until the process is signalled. Builds the
/// engine from `config.cache_root`. Embedders build their own [`Engine`],
/// call [`router`], and drive their own server.
pub async fn serve(config: Config) -> std::io::Result<()> {
    let bind = config.bind;
    // Enforce the reported cacheSize as a hard cache quota (M1.5).
    let quota = config.cache_size.map(|s| s as u64);
    let engine = Engine::with_quota(config.cache_root.clone(), quota)
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let app = router(config, engine);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "streaming server listening");
    axum::serve(listener, app).await
}
