//! M3a - /proxy end-to-end against a hermetic local origin (no container/net).
//! Exercises: playlist rewrite + header mutations, Range passthrough, request
//! header injection, and the SSRF guard blocking a non-allowlisted private host.

use std::net::SocketAddr;

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rillio_streaming_server::{router, Config, Engine};

/// A tiny origin: an HLS master, a range-capable data file, and a header echo.
async fn origin_master(State(port): State<u16>) -> impl IntoResponse {
    // Same-origin absolute, a tag URI, a rooted path, and a bare-relative line.
    let body = format!(
        "#EXTM3U\r\n\
         #EXT-X-STREAM-INF:BANDWIDTH=1\r\n\
         http://127.0.0.1:{port}/hls/720.m3u8\r\n\
         #EXT-X-KEY:METHOD=AES-128,URI=\"http://127.0.0.1:{port}/key.bin\"\r\n\
         /rooted/seg.ts\r\n\
         relative/seg.ts\r\n"
    );
    ([(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")], body)
}

async fn origin_data(headers: HeaderMap) -> Response {
    let data: Vec<u8> = (0..100u8).collect();
    if let Some(r) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        // bytes=START-END
        let spec = r.trim_start_matches("bytes=");
        let (s, e) = spec.split_once('-').unwrap();
        let (s, e): (usize, usize) = (s.parse().unwrap(), e.parse().unwrap());
        let slice = data[s..=e].to_vec();
        return (
            StatusCode::PARTIAL_CONTENT,
            [
                (header::CONTENT_RANGE, format!("bytes {s}-{e}/100")),
                (header::CONTENT_TYPE, "application/octet-stream".into()),
            ],
            slice,
        )
            .into_response();
    }
    (StatusCode::OK, data).into_response()
}

async fn origin_echo(headers: HeaderMap) -> String {
    headers
        .get("x-test")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<none>")
        .to_owned()
}

async fn spawn_origin() -> u16 {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = Router::new()
        .route("/hls/master.m3u8", get(origin_master))
        .route("/data", get(origin_data))
        .route("/echo", get(origin_echo))
        .with_state(port);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    port
}

async fn spawn_proxy(tag: &str, allow_loopback: bool) -> String {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let dir = std::env::temp_dir().join(format!("stremio-proxy-{tag}"));
    let _ = std::fs::create_dir_all(&dir);
    let mut config = Config::local(dir.clone());
    if allow_loopback {
        config.proxy_allow_private_hosts = vec!["127.0.0.1".to_owned()];
    }
    let engine = Engine::new(dir).await.unwrap();
    let app = router(config, engine);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}

fn enc(s: &str) -> String {
    form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

#[tokio::test]
async fn playlist_is_rewritten_and_headers_mutated() {
    let origin = spawn_origin().await;
    let proxy = spawn_proxy("playlist", true).await;
    let opts = format!("d={}", enc(&format!("http://127.0.0.1:{origin}")));
    let url = format!("{proxy}/proxy/{opts}/hls/master.m3u8");

    let resp = reqwest::get(&url).await.unwrap();
    assert_eq!(resp.status(), 200);
    // Playlist header mutation. (We buffer + rewrite, so hyper sets a correct
    // content-length for the rewritten body rather than the blob's forced-chunked
    // streaming - a documented, equivalent deviation. accept-ranges is the
    // meaningful assertion: a regenerated playlist is not range-addressable.)
    assert_eq!(resp.headers().get(header::ACCEPT_RANGES).unwrap(), "none");
    let body = resp.text().await.unwrap();

    // Same-origin absolute -> back through /proxy with same opts.
    assert!(body.contains(&format!("/proxy/{opts}/hls/720.m3u8")), "body: {body}");
    // URI="" in a tag rewritten.
    assert!(body.contains(&format!("URI=\"/proxy/{opts}/key.bin\"")), "body: {body}");
    // Rooted path joined onto virtual root.
    assert!(body.contains(&format!("/proxy/{opts}/rooted/seg.ts")), "body: {body}");
    // Bare-relative left untouched.
    assert!(body.contains("\nrelative/seg.ts") || body.contains("relative/seg.ts\r\n"));
    // CRLF preserved.
    assert!(body.contains("\r\n"));
}

#[tokio::test]
async fn range_passthrough() {
    let origin = spawn_origin().await;
    let proxy = spawn_proxy("range", true).await;
    let opts = format!("d={}", enc(&format!("http://127.0.0.1:{origin}")));
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{proxy}/proxy/{opts}/data"))
        .header(header::RANGE, "bytes=0-9")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 206);
    assert_eq!(resp.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-9/100");
    let body = resp.bytes().await.unwrap();
    assert_eq!(body.len(), 10);
    assert_eq!(&body[..], &(0..10u8).collect::<Vec<_>>()[..]);
}

#[tokio::test]
async fn request_header_injection() {
    let origin = spawn_origin().await;
    let proxy = spawn_proxy("inject", true).await;
    let opts = format!("d={}&h={}", enc(&format!("http://127.0.0.1:{origin}")), enc("X-Test:hello"));
    let body = reqwest::get(format!("{proxy}/proxy/{opts}/echo"))
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(body, "hello", "injected h header must reach the origin");
}

#[tokio::test]
async fn ssrf_blocks_loopback_without_allowlist() {
    let origin = spawn_origin().await;
    let proxy = spawn_proxy("ssrf", false).await; // no allowlist
    let opts = format!("d={}", enc(&format!("http://127.0.0.1:{origin}")));
    let resp = reqwest::get(format!("{proxy}/proxy/{opts}/data")).await.unwrap();
    assert_eq!(resp.status(), 403, "loopback must be blocked by the SSRF guard");
}
