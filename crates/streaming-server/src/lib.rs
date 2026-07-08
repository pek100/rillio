//! Auditable Rust replacement for the Stremio streaming server (`server.js`).
//!
//! Library-first: [`router`] returns an [`axum::Router`] the eventual native
//! host mounts in-process. [`serve`] is a convenience for the standalone bin
//! and for the oracle-diff tests.
//!
//! Milestone status lives in `docs/streaming-server-rust/` and
//! `checklists/streaming-server-rust.md`. This is **M0** — the control plane.

mod routes;

pub mod config;
pub mod types;

pub use config::Config;

use axum::routing::get;
use axum::Router;
use tower_http::cors::CorsLayer;

/// Build the streaming-server router.
///
/// CORS is permissive (`Access-Control-Allow-Origin: *`) to match the
/// container's `NO_CORS=1` behavior — safe only because the socket is expected
/// to bind loopback. Do not bind this to a public interface.
pub fn router(config: Config) -> Router {
    Router::new()
        .route("/settings", get(routes::get_settings).post(routes::post_settings))
        .route("/network-info", get(routes::network_info))
        .route("/device-info", get(routes::device_info))
        .route("/casting", get(routes::casting))
        .route("/casting/", get(routes::casting))
        .route("/heartbeat", get(routes::heartbeat))
        .route("/", get(routes::root))
        .route("/favicon.ico", get(routes::favicon))
        .layer(CorsLayer::permissive())
        .with_state(config)
}

/// Bind `config.bind` and serve until the process is signalled. Used by the
/// bin and the oracle tests; embedders call [`router`] and drive their own
/// server instead.
pub async fn serve(config: Config) -> std::io::Result<()> {
    let bind = config.bind;
    let app = router(config);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "streaming server listening");
    axum::serve(listener, app).await
}
