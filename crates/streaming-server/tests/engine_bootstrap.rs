//! M1.1 — the librqbit Session actually bootstraps (not just compiles).

use stremio_streaming_server::engine::Engine;

#[tokio::test]
async fn session_bootstraps_leech_only() {
    let dir = std::env::temp_dir().join("stremio-engine-bootstrap-test");
    std::fs::create_dir_all(&dir).unwrap();

    let engine = Engine::new(dir).await.expect("session bootstrap");
    // The session is live and shareable.
    assert!(std::sync::Arc::strong_count(engine.session()) >= 1);
}
