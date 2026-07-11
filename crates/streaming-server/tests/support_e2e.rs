//! M3b - support routes end-to-end against a hermetic local origin (no net).

use std::net::SocketAddr;

use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rillio_streaming_server::{router, Config, Engine};

const MEDIA_LEN: usize = 200_000; // all-zero => OSDb hash == size

/// 200 KB of zero bytes, Range-capable. Auto-HEAD (from `get`) reports the full
/// content-length; ranged GETs return exact 64 KiB slices for the hash.
async fn media(headers: HeaderMap) -> Response {
    let data = vec![0u8; MEDIA_LEN];
    if let Some(r) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        let spec = r.trim_start_matches("bytes=");
        let (s, e) = spec.split_once('-').unwrap();
        let (s, e): (usize, usize) = (s.parse().unwrap(), e.parse().unwrap());
        return (
            StatusCode::PARTIAL_CONTENT,
            [(header::CONTENT_RANGE, format!("bytes {s}-{e}/{MEDIA_LEN}"))],
            data[s..=e].to_vec(),
        )
            .into_response();
    }
    (StatusCode::OK, data).into_response()
}

async fn sub_srt() -> impl IntoResponse {
    "1\n00:00:01,000 --> 00:00:04,000\nHello & welcome\n\n2\n00:00:05,500 --> 00:00:08,000\n<i>World</i>\n"
}

async fn spawn_origin() -> u16 {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = Router::new()
        .route("/media.bin", get(media))
        .route("/sub.srt", get(sub_srt));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    port
}

async fn spawn_server(tag: &str) -> String {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let dir = std::env::temp_dir().join(format!("stremio-support-{tag}"));
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    let engine = Engine::new(dir.clone()).await.unwrap();
    // The subtitle/opensub SSRF guard blocks loopback by default; these tests
    // point `from`/`videoUrl` at a hermetic loopback mock on a random port (not
    // the server's own port), so allow-list 127.0.0.1 exactly as proxy_e2e does.
    // The guard's default-block behavior is covered separately below.
    let mut config = Config::local(dir);
    config.proxy_allow_private_hosts = vec!["127.0.0.1".to_owned()];
    let app = router(config, engine);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}

/// A server WITHOUT the loopback allow-list, to prove the SSRF guard blocks a
/// subtitle `from=` that points at a non-self loopback service.
async fn spawn_guarded_server(tag: &str) -> String {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let dir = std::env::temp_dir().join(format!("stremio-support-{tag}"));
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    let engine = Engine::new(dir.clone()).await.unwrap();
    let app = router(Config::local(dir), engine);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}

fn enc(s: &str) -> String {
    form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

#[tokio::test]
async fn opensub_hash_matches_zero_file_vector() {
    let origin = spawn_origin().await;
    let server = spawn_server("hash").await;
    let media = format!("http://127.0.0.1:{origin}/media.bin");
    let resp = reqwest::get(format!("{server}/opensubHash?videoUrl={}", enc(&media)))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let j: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(j["error"], serde_json::Value::Null);
    // all-zero bytes => hash == size (200000 = 0x30d40)
    assert_eq!(j["result"]["hash"], format!("{MEDIA_LEN:016x}"));
    assert_eq!(j["result"]["size"], MEDIA_LEN);
}

#[tokio::test]
async fn subtitles_vtt_conversion() {
    let origin = spawn_origin().await;
    let server = spawn_server("subvtt").await;
    let src = format!("http://127.0.0.1:{origin}/sub.srt");
    let body = reqwest::get(format!("{server}/subtitles.vtt?from={}", enc(&src)))
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(body.starts_with("WEBVTT\n\n"));
    assert!(body.contains("0\n00:00:01.000 --> 00:00:04.000\nHello &amp; welcome"));
    assert!(body.contains("<i>World</i>")); // not escaped
    assert!(!body.contains("&lt;"));
}

#[tokio::test]
async fn subtitles_srt_offset() {
    let origin = spawn_origin().await;
    let server = spawn_server("subsrt").await;
    let src = format!("http://127.0.0.1:{origin}/sub.srt");
    let body = reqwest::get(format!("{server}/subtitles.srt?from={}&offset=1000", enc(&src)))
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(!body.starts_with("WEBVTT"));
    // comma separator + shifted +1s
    assert!(body.contains("00:00:02,000 --> 00:00:05,000"));
}

#[tokio::test]
async fn subtitles_from_loopback_is_blocked_by_ssrf_guard() {
    // A malicious addon/subtitle URL that points at a local service (here the mock
    // origin, standing in for 169.254.169.254 / a router admin / another daemon)
    // must be refused. Without the loopback allow-list, fetch fails the guard and
    // the route 500s (the player then falls back to the raw URL) - the internal
    // service is never reached and its body never returned.
    let origin = spawn_origin().await;
    let server = spawn_guarded_server("ssrf").await;
    let src = format!("http://127.0.0.1:{origin}/sub.srt");
    let resp = reqwest::get(format!("{server}/subtitles.vtt?from={}", enc(&src)))
        .await
        .unwrap();
    assert_eq!(resp.status(), 500);
}

#[tokio::test]
async fn tracks_is_empty_and_yt_forbidden() {
    let server = spawn_server("stub").await;
    let t = reqwest::get(format!("{server}/tracks/{}", enc("http://x/y.mkv")))
        .await
        .unwrap();
    assert_eq!(t.status(), 200);
    assert_eq!(t.json::<serde_json::Value>().await.unwrap(), serde_json::json!([]));

    let y = reqwest::get(format!("{server}/yt/dQw4w9WgXcQ")).await.unwrap();
    assert_eq!(y.status(), 403);
}
