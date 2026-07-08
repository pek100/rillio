//! M2 — stats.json routes: null-when-absent, and real per-file fields after a
//! torrent is added (metadata only; peer-dependent fields are 0 without network).

use std::net::SocketAddr;

use serde_json::Value;
use stremio_streaming_server::{router, Config, Engine};

/// Minimal single-file `.torrent` (bencode), one piece.
fn make_torrent(name: &str, length: u64) -> Vec<u8> {
    let mut info = Vec::new();
    info.extend_from_slice(b"d");
    info.extend_from_slice(format!("6:lengthi{length}e").as_bytes());
    info.extend_from_slice(format!("4:name{}:{name}", name.len()).as_bytes());
    info.extend_from_slice(format!("12:piece lengthi{length}e").as_bytes());
    info.extend_from_slice(b"6:pieces20:");
    info.extend_from_slice(&[0u8; 20]);
    info.extend_from_slice(b"e");
    let mut t = Vec::new();
    t.extend_from_slice(b"d4:info");
    t.extend_from_slice(&info);
    t.extend_from_slice(b"e");
    t
}

async fn spawn(tag: &str) -> (String, reqwest::Client) {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let dir = std::env::temp_dir().join(format!("stremio-stats-{tag}"));
    let _ = std::fs::create_dir_all(&dir);
    let engine = Engine::new(dir.clone()).await.unwrap();
    let app = router(Config::local(dir), engine);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, reqwest::Client::new())
}

async fn get(c: &reqwest::Client, url: String) -> Value {
    c.get(url).send().await.unwrap().json().await.unwrap_or(Value::Null)
}

const IH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

#[tokio::test]
async fn stats_are_null_when_absent() {
    let (base, c) = spawn("absent").await;
    assert_eq!(get(&c, format!("{base}/stats.json")).await, serde_json::json!({}));
    assert_eq!(get(&c, format!("{base}/{IH}/stats.json")).await, Value::Null);
    assert_eq!(get(&c, format!("{base}/{IH}/0/stats.json")).await, Value::Null);
}

#[tokio::test]
async fn stats_have_real_metadata_fields_after_add() {
    let (base, c) = spawn("present").await;
    // Add a synthetic torrent via the blob route.
    let hex: String = make_torrent("movie.mkv", 123_456).iter().map(|b| format!("{b:02x}")).collect();
    let created: Value = c
        .post(format!("{base}/create"))
        .json(&serde_json::json!({ "blob": hex }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ih = created["infoHash"].as_str().unwrap().to_owned();

    // Torrent-level: real name/files, no per-file stream fields.
    let t = get(&c, format!("{base}/{ih}/stats.json")).await;
    assert_eq!(t["name"], "movie.mkv");
    assert_eq!(t["files"].as_array().unwrap().len(), 1);
    assert_eq!(t["streamName"], ""); // no idx

    // Per-file: real streamName/streamLen from metadata; progress 0 (no peers).
    let f = get(&c, format!("{base}/{ih}/0/stats.json")).await;
    assert_eq!(f["streamName"], "movie.mkv");
    assert_eq!(f["streamLen"], 123_456);
    assert!(f["streamProgress"].is_number());
    assert!(f["peers"].is_number());

    // Aggregate now contains the engine, keyed by infohash.
    let a = get(&c, format!("{base}/stats.json")).await;
    assert!(a.get(&ih).is_some());
}
