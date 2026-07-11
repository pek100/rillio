//! M4 - `/local-addon` transport.
//!
//! The streaming server hosts a Stremio addon (`org.stremio.local`, "Local
//! Files") at `/local-addon`. `crates/core` consumes it like any addon: it
//! fetches `{server}/local-addon/manifest.json`, matches the `transport_url`
//! against `profile.addons` (addon_details.rs:82-94), and resolves the
//! `local_addon` Descriptor. Without this route core shows
//! `LOCAL_ADDON_NOT_ENABLED` and local-file features break.
//!
//! Scope: this serves the **default** (disabled) manifest - `localAddonEnabled`
//! is false in our `/settings`, so the blob builds `manifestNoCatalogs`
//! (server.js:93889: name + " (without catalog support)", catalogs: []). The
//! full local-file **indexing** feature (scan the localFiles dir, parse video
//! names, imdb-match) only runs when the user enables it and is DEFERRED; the
//! resource handlers here return valid empty responses, matching the
//! no-files-indexed state.

use axum::extract::Path;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

/// The local-addon manifest (default/disabled config). Matches
/// `manifestNoCatalogs` (server.js:43383-43401, 93889). Version/description are
/// the local-addon package's (server.js:43405-43406).
fn manifest() -> Value {
    json!({
        "id": "org.stremio.local",
        "version": "1.10.0",
        "description": "Local add-on to find playable files: .torrent, .mp4, .mkv and .avi",
        "name": "Local Files (without catalog support)",
        "resources": [
            "catalog",
            { "name": "meta", "types": ["other"], "idPrefixes": ["local:", "bt:"] },
            { "name": "stream", "types": ["movie", "series"], "idPrefixes": ["tt"] }
        ],
        "types": ["movie", "series", "other"],
        "catalogs": []
    })
}

/// `GET /local-addon/manifest.json`
pub(crate) async fn local_manifest() -> Response {
    (
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        Json(manifest()),
    )
        .into_response()
}

/// `GET /local-addon/{resource}/{type}/{*rest}` - the addon resource dispatch
/// (server.js:91814). `rest` is `<id>.json` or `<id>/<extra>.json`; we don't
/// need to parse it while returning empty responses. Unknown resource → 404
/// (the blob's `next()`).
pub(crate) async fn local_resource(Path((resource, _type, _rest)): Path<(String, String, String)>) -> Response {
    let body = match resource.as_str() {
        "catalog" => json!({ "metas": [] }),
        "meta" => json!({ "meta": Value::Null }),
        "stream" => json!({ "streams": [] }),
        "subtitles" => json!({ "subtitles": [] }),
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    (
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        Json(body),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_has_required_addon_fields() {
        let m = manifest();
        assert_eq!(m["id"], "org.stremio.local");
        assert_eq!(m["name"], "Local Files (without catalog support)");
        assert!(m["catalogs"].as_array().unwrap().is_empty());
        // resources: bare "catalog" string + meta/stream objects
        let res = m["resources"].as_array().unwrap();
        assert_eq!(res[0], "catalog");
        assert_eq!(res[1]["name"], "meta");
        assert_eq!(res[1]["idPrefixes"], json!(["local:", "bt:"]));
        assert_eq!(res[2]["name"], "stream");
        assert_eq!(res[2]["idPrefixes"], json!(["tt"]));
        // stays under the 8 KiB addonCollection limit (server.js:91811)
        assert!(serde_json::to_string(&m).unwrap().len() < 8192);
    }
}
