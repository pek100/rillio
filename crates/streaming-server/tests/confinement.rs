//! M1.5 — ConfinedStorage end-to-end: a quota-exceeding torrent is refused, and
//! a path-traversal torrent is rejected. Synthetic torrents, no network.

use std::net::SocketAddr;

use stremio_streaming_server::{router, Config, Engine};

/// Build a minimal valid single-file `.torrent` (bencode) declaring `length`
/// bytes under `name`, with one piece. Enough for metadata parsing + our
/// storage-layer validation; piece hashes are not checked without data.
fn make_torrent(name: &str, length: u64) -> Vec<u8> {
    // info dict keys must be bencode-sorted: length, name, piece length, pieces.
    let mut info = Vec::new();
    info.extend_from_slice(b"d");
    info.extend_from_slice(format!("6:lengthi{length}e").as_bytes());
    info.extend_from_slice(format!("4:name{}:{name}", name.len()).as_bytes());
    info.extend_from_slice(format!("12:piece lengthi{length}e").as_bytes());
    // one piece => 20-byte pieces string
    info.extend_from_slice(b"6:pieces20:");
    info.extend_from_slice(&[0u8; 20]);
    info.extend_from_slice(b"e");

    let mut torrent = Vec::new();
    torrent.extend_from_slice(b"d4:info");
    torrent.extend_from_slice(&info);
    torrent.extend_from_slice(b"e");
    torrent
}

async fn engine(tag: &str, quota: Option<u64>) -> Engine {
    let dir = std::env::temp_dir().join(format!("stremio-confine-{tag}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    Engine::with_quota(dir, quota).await.unwrap()
}

#[tokio::test]
async fn oversized_torrent_is_refused_by_quota() {
    // 2 GiB declared file, 1 MiB cache cap.
    let engine = engine("quota-over", Some(1_000_000)).await;
    let torrent = make_torrent("big.mkv", 2_000_000_000);
    let result = engine.add_blob(torrent).await;
    assert!(
        result.is_err(),
        "a 2GB torrent must be refused under a 1MB quota"
    );
}

#[tokio::test]
async fn within_quota_torrent_is_accepted() {
    // 500 KiB declared file, 1 MiB cap → allowed.
    let engine = engine("quota-under", Some(1_000_000)).await;
    let torrent = make_torrent("small.mkv", 500_000);
    let result = engine.add_blob(torrent).await;
    assert!(result.is_ok(), "a 500KB torrent fits a 1MB quota");
}

#[tokio::test]
async fn traversal_path_torrent_is_rejected() {
    // A name carrying a separator/traversal is rejected (librqbit-core at parse;
    // ConfinedStorage would independently reject the resolved path too).
    let engine = engine("traversal", None).await;
    let torrent = make_torrent("../../Startup/evil.exe", 1000);
    let result = engine.add_blob(torrent).await;
    assert!(result.is_err(), "a traversal path must never be added");
}

#[tokio::test]
async fn unlimited_quota_does_not_reject_on_size() {
    // With no quota the size gate never fires. (Kept disk-safe: a huge declared
    // length would fail on librqbit's file pre-allocation, not on our check.)
    let engine = engine("nolimit", None).await;
    let torrent = make_torrent("normal.mkv", 500_000);
    let result = engine.add_blob(torrent).await;
    assert!(result.is_ok(), "no quota → size gate never rejects");
}

// Confidence check that the router still builds with the confined engine.
#[tokio::test]
async fn router_builds_with_confined_engine() {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let dir = std::env::temp_dir().join("stremio-confine-router");
    let _ = std::fs::create_dir_all(&dir);
    let engine = Engine::with_quota(dir.clone(), Some(2_147_483_648)).await.unwrap();
    let _app = router(Config::local(dir), engine);
}
