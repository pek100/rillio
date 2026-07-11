//! M1.3 - the media stream: `GET`/`HEAD` `/:ih/:idx` (+ `/:ih/:idx/*`).
//!
//! Reproduces the blob's non-standard Range contract exactly (server.js
//! 18203-18272): first-range-only, NO 416 (unsatisfiable falls through to 200),
//! the DLNA headers (with the byte-exact embedded-space bug), and the
//! `?external`/`?download`/`?subtitles` query flags.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, RawQuery, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use crate::engine::{Engine, Handle};
use crate::torrent;

/// `contentFeatures.dlna.org` - byte-for-byte from server.js:18291, including
/// the embedded space after `017000` (a blob bug we reproduce for parity).
const DLNA_CONTENT_FEATURES: &str =
    "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=017000 00000000000000000000000000";

/// `/{info_hash}/{idx}`
pub(crate) async fn stream(
    state: State<Engine>,
    method: Method,
    Path((info_hash, idx)): Path<(String, String)>,
    query: RawQuery,
    headers: HeaderMap,
) -> Response {
    handle_stream(state, method, info_hash, idx, query, headers).await
}

/// `/{info_hash}/{idx}/{*rest}` - trailing path (players append the filename);
/// it does not change file resolution.
pub(crate) async fn stream_rest(
    state: State<Engine>,
    method: Method,
    Path((info_hash, idx, _rest)): Path<(String, String, String)>,
    query: RawQuery,
    headers: HeaderMap,
) -> Response {
    handle_stream(state, method, info_hash, idx, query, headers).await
}

#[derive(Default)]
struct Flags {
    external: bool,
    download: bool,
    subtitles: Option<String>,
    f: Vec<String>,
}

fn parse_flags(query: &Option<String>) -> Flags {
    let mut flags = Flags::default();
    let Some(q) = query else { return flags };
    for (k, v) in url::form_urlencoded::parse(q.as_bytes()) {
        match k.as_ref() {
            "external" => flags.external = true,
            "download" => flags.download = true,
            "subtitles" => flags.subtitles = Some(v.into_owned()),
            "f" => flags.f.push(v.into_owned()),
            _ => {}
        }
    }
    flags
}

async fn handle_stream(
    State(engine): State<Engine>,
    method: Method,
    info_hash: String,
    idx: String,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    if !torrent::is_valid_infohash(&info_hash) {
        return err500();
    }
    let info_hash = info_hash.to_lowercase();
    let flags = parse_flags(&query);

    // Idempotent get-or-create; needs metadata for file resolution. Reuses the
    // live handle if already managed (never re-adds - that would reset a playing
    // torrent to `initializing` and 500 concurrent reads).
    let handle = match engine.get_or_create(&info_hash).await {
        Ok(h) => h,
        Err(e) => {
            tracing::error!("stream {info_hash}: get_or_create failed: {e:#}");
            return err500();
        }
    };
    // Mark active so the cache sweeper never evicts the title being played.
    engine.touch(&info_hash);
    let files = Engine::files(&handle);
    if files.is_empty() {
        tracing::error!("stream {info_hash}: metadata not resolved (no files)");
        return err500(); // metadata never resolved
    }

    let Some(i) = resolve_index(&files, &idx, &flags) else {
        tracing::error!("stream {info_hash}: index {idx} did not resolve");
        return err500(); // invalid index/filename → 500, never 404 (blob parity)
    };
    let file = &files[i];

    // ?external ⇒ 307 to /:ih/:name BEFORE opening any stream (server.js:18252).
    if flags.external {
        let mut loc = format!("/{}/{}", info_hash, urlencode_path(&file.name));
        if flags.download {
            loc.push_str("?download=1");
        }
        return Redirect::temporary(&loc).into_response();
    }

    let total = file.length;
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|r| parse_range(total, r));

    let mut resp_headers = base_headers(&file.name);
    if flags.download {
        resp_headers.insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{}\";", file.name))
                .unwrap_or(HeaderValue::from_static("attachment")),
        );
    }
    if let Some(sub) = &flags.subtitles {
        if let Ok(v) = HeaderValue::from_str(sub) {
            resp_headers.insert("CaptionInfo.sec", v);
        }
    }

    let (status, start, content_len) = match range {
        Some((s, e)) => {
            resp_headers.insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes {s}-{e}/{total}")).unwrap(),
            );
            // parse_range guarantees size > 0 and s <= e, so this is >= 1.
            (StatusCode::PARTIAL_CONTENT, s, e - s + 1)
        }
        // No/unsatisfiable/malformed range ⇒ 200 full body. There is NO 416.
        // Content-Length is the file length directly, so a 0-byte file reports
        // Content-Length: 0 (not 1, which the old end-start+1 gave when total==0).
        None => (StatusCode::OK, 0, total),
    };
    resp_headers.insert(header::CONTENT_LENGTH, HeaderValue::from(content_len));

    // HEAD: headers only, never open the FileStream (server.js:18269-18270).
    if method == Method::HEAD {
        return (status, resp_headers).into_response();
    }

    let body = match open_body(&handle, i, start, content_len).await {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("stream {info_hash}: open_body failed: {e:#}");
            return err500();
        }
    };
    (status, resp_headers, body).into_response()
}

/// Open a librqbit FileStream, seek to `start`, limit to `len` bytes, and adapt
/// it to an axum body. The read parks until each covering piece is verified and
/// the seek re-prioritizes download (librqbit FileStream; spec §4).
async fn open_body(handle: &Handle, file_id: usize, start: u64, len: u64) -> anyhow::Result<Body> {
    let mut fs = Arc::clone(handle).stream(file_id)?;
    if start > 0 {
        fs.seek(std::io::SeekFrom::Start(start)).await?;
    }
    Ok(Body::from_stream(ReaderStream::new(fs.take(len))))
}

/// Resolve the `:idx` union (server.js:18213-18249):
/// `?f=` selector → numeric → `-1` GuessFileIdx → url-encoded filename.
fn resolve_index(files: &[crate::types::File], idx: &str, flags: &Flags) -> Option<usize> {
    if !flags.f.is_empty() {
        if let Some(i) = torrent::file_must_include(files, &flags.f) {
            return Some(i);
        }
    }
    if let Ok(n) = idx.parse::<i64>() {
        if n == -1 {
            let g = torrent::guess_file_idx(files);
            return (g >= 0).then_some(g as usize);
        }
        return usize::try_from(n).ok().filter(|&i| i < files.len());
    }
    // Filename form.
    let decoded = percent_decode(idx);
    files.iter().position(|f| f.name == decoded)
}

/// range-parser semantics (server.js `rangeParser(size, header)[0]`): first
/// range only; malformed/unsatisfiable ⇒ None ⇒ caller serves full 200.
/// Returns inclusive `(start, end)`.
fn parse_range(size: u64, header: &str) -> Option<(u64, u64)> {
    let spec = header.strip_prefix("bytes=")?;
    let first = spec.split(',').next()?.trim();
    let (s, e) = first.split_once('-')?;
    let (start, end) = if s.is_empty() {
        // suffix: -N ⇒ last N bytes
        let n: u64 = e.parse().ok()?;
        if n == 0 {
            return None;
        }
        (size.saturating_sub(n), size.saturating_sub(1))
    } else {
        let start: u64 = s.parse().ok()?;
        let end: u64 = if e.is_empty() {
            size.saturating_sub(1)
        } else {
            e.parse::<u64>().ok()?.min(size.saturating_sub(1))
        };
        (start, end)
    };
    // Unsatisfiable ⇒ None (NO 416).
    if size == 0 || start > end || start >= size {
        return None;
    }
    Some((start, end))
}

fn base_headers(name: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("transferMode.dlna.org", HeaderValue::from_static("Streaming"));
    h.insert(
        "contentFeatures.dlna.org",
        HeaderValue::from_static(DLNA_CONTENT_FEATURES),
    );
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("max-age=0, no-cache"),
    );
    let ct = mime_guess::from_path(name).first_or_octet_stream();
    if let Ok(v) = HeaderValue::from_str(ct.as_ref()) {
        h.insert(header::CONTENT_TYPE, v);
    }
    h
}

fn err500() -> Response {
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

fn percent_decode(s: &str) -> String {
    percent_decode_bytes(s.as_bytes())
}

fn percent_decode_bytes(bytes: &[u8]) -> String {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Encode a filename for the redirect Location path (keep it path-safe).
fn urlencode_path(name: &str) -> String {
    name.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn first_range_only_and_206() {
        // Multi-range: only the first is honored (no multipart).
        assert_eq!(parse_range(1000, "bytes=0-99,200-299"), Some((0, 99)));
    }

    #[test]
    fn open_ended_range() {
        assert_eq!(parse_range(1000, "bytes=500-"), Some((500, 999)));
    }

    #[test]
    fn suffix_range() {
        assert_eq!(parse_range(1000, "bytes=-100"), Some((900, 999)));
    }

    #[test]
    fn end_clamped_to_size() {
        assert_eq!(parse_range(1000, "bytes=0-99999"), Some((0, 999)));
    }

    #[test]
    fn unsatisfiable_is_none_not_416() {
        // start >= size ⇒ None ⇒ caller serves full 200, never 416.
        assert_eq!(parse_range(1000, "bytes=2000-3000"), None);
    }

    #[test]
    fn malformed_is_none() {
        assert_eq!(parse_range(1000, "chunks=0-1"), None);
        assert_eq!(parse_range(1000, "bytes=abc"), None);
    }
}
