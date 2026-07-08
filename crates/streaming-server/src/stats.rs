//! M2 — the `stats.json` family. Each returns `null` when the engine is not
//! managed (getStatistics returns null for an absent engine, server.js:18295);
//! these routes never auto-create.

use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{Map, Value};

use crate::engine::{Engine, Handle};
use crate::torrent::{cache_path, default_peer_search};

/// `GET /:ih/:idx/stats.json` — per-file stats. Core deserializes this into
/// `Option<Statistics>`; `null` ⇒ None. `idx` is a resolved file index (core
/// never sends -1 here).
pub(crate) async fn stats_file(
    State(engine): State<Engine>,
    Path((info_hash, idx)): Path<(String, String)>,
) -> Response {
    let Some(handle) = engine.get(&info_hash.to_lowercase()) else {
        return Json(Value::Null).into_response();
    };
    let idx = idx.parse::<usize>().ok();
    Json(statistics(&engine, &handle, idx)).into_response()
}

/// `GET /:ih/stats.json` — torrent-level stats (video's filename/OpenSubtitles
/// resolver reads this; core does not).
pub(crate) async fn stats_torrent(
    State(engine): State<Engine>,
    Path(info_hash): Path<String>,
) -> Response {
    let Some(handle) = engine.get(&info_hash.to_lowercase()) else {
        return Json(Value::Null).into_response();
    };
    Json(statistics(&engine, &handle, None)).into_response()
}

/// `GET /stats.json` — aggregate over all engines (debug; no consumer). `{}`
/// when empty; `?sys=1` is intentionally NOT implemented (host-info leak).
pub(crate) async fn stats_aggregate(State(engine): State<Engine>) -> Response {
    let mut out = Map::new();
    for handle in engine.all() {
        let ih = Engine::info_hash_hex(&handle);
        out.insert(ih, statistics(&engine, &handle, None));
    }
    Json(Value::Object(out)).into_response()
}

fn statistics(engine: &Engine, handle: &Handle, idx: Option<usize>) -> Value {
    let stats = engine.statistics(
        handle,
        cache_path(handle),
        default_peer_search(handle),
        idx,
    );
    serde_json::to_value(stats).unwrap_or(Value::Null)
}
