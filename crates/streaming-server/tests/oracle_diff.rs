//! Oracle-diff harness — the backbone of the whole rewrite.
//!
//! For each endpoint we send the same request to the Rust server and to the
//! reference container (`docker/streaming-server`, http://127.0.0.1:11470) and
//! compare the responses. Environment-specific fields (baseUrl, serverVersion,
//! appPath, cacheRoot, cacheSize, network IPs) are normalized out — we assert
//! the *contract* holds, not that two different machines report identical paths.
//!
//! The container is optional: if 11470 is unreachable the container-diff asserts
//! are skipped with a printed notice, so the suite still validates the Rust
//! server's own shape in CI. Run the container to get the full diff:
//!   docker compose -f docker/streaming-server/compose.yaml up -d
//!
//! Run: cargo test -p rillio-streaming-server --test oracle_diff -- --nocapture

use std::net::SocketAddr;

use serde_json::Value;
use rillio_streaming_server::{router, Config, Engine};

const CONTAINER: &str = "http://127.0.0.1:11470";

/// Fields whose values legitimately differ between the Rust server and the
/// container (host paths, versions, dynamic IPs). We compare their presence and
/// JSON type, not their contents.
const VOLATILE: &[&str] = &[
    "baseUrl",
    "serverVersion",
    "appPath",
    "cacheRoot",
    "cacheSize",
    "availableInterfaces",
    "selections",
];

/// Spawn the Rust server on an ephemeral port; return its base URL.
async fn spawn_rust() -> String {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .expect("bind ephemeral");
    let addr = listener.local_addr().unwrap();
    let base = format!("http://127.0.0.1:{}", addr.port());
    let dir = std::env::temp_dir().join("stremio-oracle-test");
    let config = Config::local(dir.clone());
    let engine = Engine::new(dir).await.expect("engine");
    let app = router(config, engine);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    base
}

async fn get_json(base: &str, path: &str) -> Option<(reqwest::StatusCode, Value)> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    let resp = client.get(format!("{base}{path}")).send().await.ok()?;
    let status = resp.status();
    let body = resp.json::<Value>().await.unwrap_or(Value::Null);
    Some((status, body))
}

async fn container_up() -> bool {
    get_json(CONTAINER, "/heartbeat").await.is_some()
}

/// Assert two JSON values have the same shape: same object keys (recursively),
/// same array-ness, same scalar type. Values under `VOLATILE` keys are compared
/// by type only.
fn assert_same_shape(path: &str, rust: &Value, oracle: &Value) {
    match (rust, oracle) {
        (Value::Object(r), Value::Object(o)) => {
            let mut r_keys: Vec<_> = r.keys().cloned().collect();
            let mut o_keys: Vec<_> = o.keys().cloned().collect();
            r_keys.sort();
            o_keys.sort();
            assert_eq!(
                r_keys, o_keys,
                "{path}: object keys differ\n  rust:   {r_keys:?}\n  oracle: {o_keys:?}"
            );
            for (k, rv) in r {
                let ov = &o[k];
                if VOLATILE.contains(&k.as_str()) {
                    assert_eq!(
                        std::mem::discriminant(rv),
                        std::mem::discriminant(ov),
                        "{path}.{k}: volatile field type differs"
                    );
                } else {
                    assert_same_shape(&format!("{path}.{k}"), rv, ov);
                }
            }
        }
        (Value::Array(r), Value::Array(o)) => {
            // Compare element shape using the first element if present.
            if let (Some(rf), Some(of)) = (r.first(), o.first()) {
                assert_same_shape(&format!("{path}[0]"), rf, of);
            }
        }
        (r, o) => assert_eq!(
            std::mem::discriminant(r),
            std::mem::discriminant(o),
            "{path}: scalar type differs (rust={r:?}, oracle={o:?})"
        ),
    }
}

#[tokio::test]
async fn settings_matches_core_contract() {
    let rust = spawn_rust().await;
    let (status, body) = get_json(&rust, "/settings").await.expect("rust /settings");
    assert_eq!(status, 200);

    // The fields core's `Settings` struct requires (settings.rs). Their absence
    // is what cascades core to "server down".
    let v = &body["values"];
    for key in [
        "appPath",
        "cacheRoot",
        "serverVersion",
        "remoteHttps",
        "cacheSize",
        "btMaxConnections",
        "btHandshakeTimeout",
        "btRequestTimeout",
        "btDownloadSpeedSoftLimit",
        "btDownloadSpeedHardLimit",
        "btMinPeersForStable",
    ] {
        assert!(!v[key].is_null() || key == "cacheSize", "values.{key} missing");
    }
    // remoteHttps MUST be the empty string, never null.
    assert_eq!(v["remoteHttps"], Value::String(String::new()));
    assert!(body["baseUrl"].is_string());
    assert!(body["options"].is_array());

    if container_up().await {
        let (_, oracle) = get_json(CONTAINER, "/settings").await.unwrap();
        assert_same_shape("settings", &body, &oracle);
    } else {
        eprintln!("[oracle] container down — skipped /settings shape diff");
    }
}

#[tokio::test]
async fn control_plane_endpoints() {
    let rust = spawn_rust().await;

    let (s, b) = get_json(&rust, "/heartbeat").await.unwrap();
    assert_eq!(s, 200);
    assert_eq!(b, serde_json::json!({"success": true}));

    let (s, b) = get_json(&rust, "/network-info").await.unwrap();
    assert_eq!(s, 200);
    assert!(b["availableInterfaces"].is_array());

    let (s, b) = get_json(&rust, "/device-info").await.unwrap();
    assert_eq!(s, 200);
    assert!(b["availableHardwareAccelerations"] == Value::Bool(false));

    let (s, b) = get_json(&rust, "/casting").await.unwrap();
    assert_eq!(s, 200);
    assert!(b.is_array());
}
