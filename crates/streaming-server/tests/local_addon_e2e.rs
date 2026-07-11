//! M4 - /local-addon transport serves the manifest and empty resource responses.

use std::net::SocketAddr;

use rillio_streaming_server::{router, Config, Engine};

async fn spawn() -> String {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let dir = std::env::temp_dir().join("stremio-localaddon-test");
    let _ = std::fs::create_dir_all(&dir);
    let engine = Engine::new(dir.clone()).await.unwrap();
    tokio::spawn(async move { axum::serve(listener, router(Config::local(dir), engine)).await.unwrap() });
    base
}

#[tokio::test]
async fn manifest_and_resources() {
    let base = spawn().await;
    let c = reqwest::Client::new();

    let m: serde_json::Value = c
        .get(format!("{base}/local-addon/manifest.json"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(m["id"], "org.stremio.local");
    assert_eq!(m["version"], "1.10.0"); // valid semver (core parses into Version)
    assert!(m["catalogs"].as_array().unwrap().is_empty());

    // Resource dispatch returns valid empty responses (no files indexed).
    let get = |url: String| {
        let c = c.clone();
        async move { c.get(url).send().await.unwrap().json::<serde_json::Value>().await.unwrap() }
    };
    assert_eq!(get(format!("{base}/local-addon/stream/movie/tt123.json")).await, serde_json::json!({"streams": []}));
    assert_eq!(get(format!("{base}/local-addon/meta/other/bt:abc.json")).await, serde_json::json!({"meta": null}));
    assert_eq!(get(format!("{base}/local-addon/catalog/other/local.json")).await, serde_json::json!({"metas": []}));

    // Unknown resource → 404.
    let r = c.get(format!("{base}/local-addon/bogus/x/y.json")).send().await.unwrap();
    assert_eq!(r.status(), 404);
}
