//! Regression: the Cache page's "playable file" resolution.
//!
//! `/cache/list` reports `fileIdx` so the Cached page can offer Play. It used to
//! mean "exactly one file is selected", which broke on real scene releases: a
//! movie shipping an .nfo beside the .mkv reported two files, so no fileIdx, so
//! a finished 4 GB movie rendered with no Play button. The rule is now "exactly
//! one VIDEO among the selected files".

use std::net::SocketAddr;

use rillio_streaming_server::{router, Config, Engine};
use serde_json::Value;

/// Minimal multi-file `.torrent` (bencode), one piece. Dict keys are emitted in
/// lexicographic order, as bencode requires.
fn make_multi_torrent(name: &str, files: &[(&str, u64)]) -> Vec<u8> {
    let total: u64 = files.iter().map(|(_, len)| len).sum();
    let mut info = Vec::new();
    info.extend_from_slice(b"d5:filesl");
    for (fname, len) in files {
        info.extend_from_slice(format!("d6:lengthi{len}e4:pathl{}:{fname}ee", fname.len()).as_bytes());
    }
    info.extend_from_slice(b"e");
    info.extend_from_slice(format!("4:name{}:{name}", name.len()).as_bytes());
    info.extend_from_slice(format!("12:piece lengthi{total}e").as_bytes());
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
    let dir = std::env::temp_dir().join(format!("rillio-playable-{tag}"));
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    let engine = Engine::new(dir.clone()).await.unwrap();
    let app = router(Config::local(dir), engine);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, reqwest::Client::new())
}

async fn add(c: &reqwest::Client, base: &str, blob: Vec<u8>) {
    let hex: String = blob.iter().map(|b| format!("{b:02x}")).collect();
    let created: Value = c
        .post(format!("{base}/create"))
        .json(&serde_json::json!({ "blob": hex }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(created["infoHash"].as_str().is_some(), "create failed: {created}");
}

async fn only_entry(c: &reqwest::Client, base: &str) -> Value {
    let list: Vec<Value> = c
        .get(format!("{base}/cache/list"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(list.len(), 1, "expected exactly one cache entry, got {list:?}");
    list.into_iter().next().unwrap()
}

#[tokio::test]
async fn movie_with_an_nfo_beside_it_is_still_playable() {
    let (base, c) = spawn("nfo").await;
    add(
        &c,
        &base,
        make_multi_torrent("Some.Movie.2026.1080p", &[("Some.Movie.2026.1080p.mkv", 4_000_000), ("Some.Movie.2026.1080p.nfo", 2_689)]),
    )
    .await;

    let entry = only_entry(&c, &base).await;
    // Both files are selected (honest count), but the lone VIDEO is playable.
    assert_eq!(entry["fileCount"], 2);
    assert_eq!(entry["fileIdx"], 0, "the .mkv must be the playable file");
    // The row names the movie, not the torrent/folder.
    assert_eq!(entry["name"], "Some.Movie.2026.1080p.mkv");
}

#[tokio::test]
async fn season_pack_stays_ambiguous() {
    let (base, c) = spawn("pack").await;
    add(
        &c,
        &base,
        make_multi_torrent("Some.Show.S01", &[("S01E01.mkv", 1_000_000), ("S01E02.mkv", 1_000_000)]),
    )
    .await;

    let entry = only_entry(&c, &base).await;
    // Two videos: which one would Play mean? Correctly offers none.
    assert_eq!(entry["fileCount"], 2);
    assert!(entry.get("fileIdx").is_none(), "a season pack must not claim a playable file");
    assert_eq!(entry["name"], "Some.Show.S01");
}

#[tokio::test]
async fn selection_with_no_video_is_not_playable() {
    let (base, c) = spawn("novideo").await;
    add(&c, &base, make_multi_torrent("Just.Extras", &[("readme.nfo", 100), ("cover.jpg", 2_000)])).await;

    let entry = only_entry(&c, &base).await;
    assert!(entry.get("fileIdx").is_none());
    assert_eq!(entry["name"], "Just.Extras");
}
