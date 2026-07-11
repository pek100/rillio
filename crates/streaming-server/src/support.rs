//! M3b — non-ffmpeg support routes.
//!
//! - `/opensubHash` — OpenSubtitles movie hash (spec 04 B.1)
//! - `/subtitles.vtt` / `.srt` — SRT re-serializer (B.2)
//! - `/subtitlesTracks` — SRT → cue array (B.3)
//! - `/tracks/:url` — track enumeration; MKV/EBML demux deferred, returns `[]` (B.3)
//! - `/yt/:id`(`.json`) — YouTube redirect; extractor deferred, returns 403 (B.4)

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use url::Url;

use crate::config::Config;
use crate::ssrf::{self, Policy};

const CHUNK: u64 = 65_536;

/// SSRF policy for the support routes: block private/internal ranges, but allow
/// the server's OWN loopback socket. Their `videoUrl=` / `from=` / `subsUrl=`
/// legitimately point back at our torrent or `/proxy` routes on 127.0.0.1:<port>,
/// yet must not be turned into a reach into other local services (169.254.169.254,
/// a router admin, another localhost daemon).
fn support_policy(cfg: &Config) -> Policy {
    Policy::AllowSelf { self_port: cfg.bind.port() }
}

// ---------------------------------------------------------------------------
// /opensubHash
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct HashQuery {
    #[serde(rename = "videoUrl")]
    video_url: String,
}

/// `GET /opensubHash?videoUrl=…` → `{error, result:{hash,size}}`.
///
/// The `videoUrl` legitimately points back at this server's own loopback torrent
/// route, so the SSRF guard here allows self-loopback ([`support_policy`]) while
/// still blocking every other private/internal destination.
pub(crate) async fn opensub_hash(
    State(cfg): State<Config>,
    Query(q): Query<HashQuery>,
) -> Response {
    match compute_osdb_hash(&cfg, &q.video_url).await {
        Ok((hash, size)) => Json(json!({"error": null, "result": {"hash": hash, "size": size}}))
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e, "result": null})),
        )
            .into_response(),
    }
}

async fn compute_osdb_hash(cfg: &Config, url: &str) -> Result<(String, u64), String> {
    // HEAD, following a few redirects manually (each hop re-vetted + pinned; our
    // clients have redirects off). The client pinned to the FINAL url is reused
    // for the ranged reads below.
    let policy = support_policy(cfg);
    let mut current = url.to_owned();
    let mut pinned = None;
    let mut size = None;
    for _ in 0..5 {
        let parsed = Url::parse(&current).map_err(|e| e.to_string())?;
        let client = ssrf::vet_and_pin(cfg, &parsed, policy)
            .await
            .map_err(|s| format!("blocked destination: {s}"))?;
        let resp = client.head(&current).send().await.map_err(|e| e.to_string())?;
        if resp.status().is_redirection() {
            if let Some(loc) = resp.headers().get(header::LOCATION).and_then(|v| v.to_str().ok()) {
                current = resp.url().join(loc).map_err(|e| e.to_string())?.to_string();
                continue;
            }
        }
        if !resp.status().is_success() {
            return Err(format!("HEAD failed: {}", resp.status()));
        }
        size = resp
            .headers()
            .get(header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        pinned = Some(client);
        break;
    }
    let size = size.ok_or_else(|| "missing content-length".to_owned())?;
    let client = pinned.ok_or_else(|| "too many redirects".to_owned())?;
    if size < CHUNK {
        return Err("file too small for hash".to_owned());
    }

    let head = ranged_get(&client, &current, 0, CHUNK - 1).await?;
    let tail = ranged_get(&client, &current, size - CHUNK, size - 1).await?;
    if head.len() as u64 != CHUNK || tail.len() as u64 != CHUNK {
        return Err("short read".to_owned());
    }
    Ok((osdb_hash(size, &head, &tail), size))
}

async fn ranged_get(
    client: &reqwest::Client,
    url: &str,
    start: u64,
    end: u64,
) -> Result<bytes::Bytes, String> {
    let resp = client
        .get(url)
        .header(header::RANGE, format!("bytes={start}-{end}"))
        .header("enginefs-prio", "10")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.bytes().await.map_err(|e| e.to_string())
}

/// OSDb movie hash: `(size + Σ u64_le(head) + Σ u64_le(tail)) mod 2^64`, 16-hex.
/// head/tail are each exactly 64 KiB (8192 little-endian u64 words). Do NOT use
/// the blob's `/16` divisor — that is an artifact of its zero-pad trick; sum all
/// 65536 bytes (spec 04 B.1).
fn osdb_hash(size: u64, head: &[u8], tail: &[u8]) -> String {
    let mut h = size;
    for w in head.chunks_exact(8).chain(tail.chunks_exact(8)) {
        h = h.wrapping_add(u64::from_le_bytes(w.try_into().unwrap()));
    }
    format!("{h:016x}")
}

// ---------------------------------------------------------------------------
// /subtitles.:ext  and  /subtitlesTracks
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct SubtitlesQuery {
    from: String,
    #[serde(default)]
    offset: Option<i64>,
}

#[derive(Deserialize)]
pub(crate) struct SubtitlesTracksQuery {
    #[serde(rename = "subsUrl")]
    subs_url: String,
}

/// `GET /subtitles.vtt?from=…&offset=…` — re-serialize source cues as WEBVTT.
pub(crate) async fn subtitles_vtt(
    cfg: State<Config>,
    q: Query<SubtitlesQuery>,
) -> Response {
    subtitles_inner(cfg, q, true).await
}

/// `GET /subtitles.srt?from=…&offset=…` — re-serialize source cues as SRT.
pub(crate) async fn subtitles_srt(
    cfg: State<Config>,
    q: Query<SubtitlesQuery>,
) -> Response {
    subtitles_inner(cfg, q, false).await
}

/// M3b supports SRT sources (the dominant case); a non-SRT source 500s and the
/// player falls back to the raw URL (withHTMLSubtitles.js:452-460).
async fn subtitles_inner(
    State(cfg): State<Config>,
    Query(q): Query<SubtitlesQuery>,
    is_vtt: bool,
) -> Response {
    let text = match fetch_text(&cfg, &q.from).await {
        Ok(t) => t,
        Err(_) => return err500(),
    };
    let cues = parse_srt(&text);
    if cues.is_empty() {
        return err500(); // demux/empty ⇒ 500 (graceful client fallback)
    }
    let body = serialize_cues(&cues, is_vtt, q.offset.unwrap_or(0));
    let ct = if is_vtt { "text/vtt" } else { "application/x-subrip" };
    ([(header::CONTENT_TYPE, ct)], body).into_response()
}

/// `GET /subtitlesTracks?subsUrl=…` → `{error, result:[cues]}` (SRT source).
pub(crate) async fn subtitles_tracks(
    State(cfg): State<Config>,
    Query(q): Query<SubtitlesTracksQuery>,
) -> Response {
    let text = match fetch_text(&cfg, &q.subs_url).await {
        Ok(t) => t,
        Err(_) => return err500(),
    };
    let cues = parse_srt(&text);
    if cues.is_empty() {
        return err500();
    }
    let result: Vec<_> = cues
        .iter()
        .map(|c| json!({"start": c.start, "end": c.end, "text": c.text}))
        .collect();
    Json(json!({"error": null, "result": result})).into_response()
}

/// `GET /tracks/:url` — track enumeration. Full MKV/EBML demux is deferred; the
/// blob returns `200 []` on any failure (server.js:46651-46655), so an empty
/// list is a safe, non-breaking stub (no embedded tracks surfaced).
pub(crate) async fn tracks(Path(_url): Path<String>) -> Response {
    Json(json!([])).into_response()
}

/// `GET /yt/:id`(`.json`) — deferred (needs a YouTube extractor; upstream churns
/// constantly). The blob's failure code is 403; we return it honestly.
pub(crate) async fn yt(Path(_id): Path<String>) -> Response {
    StatusCode::FORBIDDEN.into_response()
}

async fn fetch_text(cfg: &Config, url: &str) -> Result<String, String> {
    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    let client = ssrf::vet_and_pin(cfg, &parsed, support_policy(cfg))
        .await
        .map_err(|s| format!("blocked destination: {s}"))?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("fetch {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

fn err500() -> Response {
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

// ---------------------------------------------------------------------------
// SRT parsing + (VTT|SRT) re-serialization
// ---------------------------------------------------------------------------

struct Cue {
    start: i64, // ms
    end: i64,
    text: String,
}

/// Parse SRT into cues. Tolerant of `\r\n`/`\n`, optional index lines, and
/// multi-line cue text. Blocks are separated by blank lines.
fn parse_srt(input: &str) -> Vec<Cue> {
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    let mut cues = Vec::new();
    for block in normalized.split("\n\n") {
        let mut lines = block.lines().filter(|l| !l.trim().is_empty()).peekable();
        // Skip a leading numeric index line if present.
        if let Some(first) = lines.peek() {
            if first.trim().parse::<u64>().is_ok() {
                lines.next();
            }
        }
        let Some(timing) = lines.next() else { continue };
        let Some((start, end)) = parse_timing(timing) else { continue };
        let text = lines.collect::<Vec<_>>().join("\n");
        cues.push(Cue { start, end, text });
    }
    cues
}

/// Parse `HH:MM:SS,mmm --> HH:MM:SS,mmm` (also accepts `.` as the ms separator).
fn parse_timing(line: &str) -> Option<(i64, i64)> {
    let (l, r) = line.split_once("-->")?;
    Some((parse_ts(l.trim())?, parse_ts(r.trim())?))
}

fn parse_ts(s: &str) -> Option<i64> {
    // HH:MM:SS[,.]mmm — take the leading token (drop any trailing cue settings).
    let s = s.split_whitespace().next()?;
    let (hms, ms) = s.split_once([',', '.'])?;
    let mut it = hms.split(':');
    let h: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    let sec: i64 = it.next()?.parse().ok()?;
    let ms: i64 = ms.parse().ok()?;
    Some(((h * 3600 + m * 60 + sec) * 1000) + ms)
}

fn serialize_cues(cues: &[Cue], is_vtt: bool, offset: i64) -> String {
    let mut out = String::new();
    if is_vtt {
        out.push_str("WEBVTT\n\n");
    }
    for (i, c) in cues.iter().enumerate() {
        let start = (c.start + offset).max(0);
        let end = (c.end + offset).max(0);
        out.push_str(&i.to_string());
        out.push('\n');
        out.push_str(&format_ts(start, is_vtt));
        out.push_str(" --> ");
        out.push_str(&format_ts(end, is_vtt));
        out.push('\n');
        out.push_str(&c.text.replace('&', "&amp;")); // only & is escaped
        out.push_str("\n\n");
    }
    out
}

/// `HH:mm:ss.SSS` (VTT, dot) or `HH:mm:ss,SSS` (SRT, comma).
fn format_ts(ms: i64, is_vtt: bool) -> String {
    let sep = if is_vtt { '.' } else { ',' };
    let h = ms / 3_600_000;
    let m = (ms % 3_600_000) / 60_000;
    let s = (ms % 60_000) / 1000;
    let milli = ms % 1000;
    format!("{h:02}:{m:02}:{s:02}{sep}{milli:03}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn osdb_hash_zero_file_equals_size() {
        // All-zero bytes: head/tail sums are 0, so hash = size (in hex).
        let head = vec![0u8; CHUNK as usize];
        let tail = vec![0u8; CHUNK as usize];
        let size = 200_000u64;
        assert_eq!(osdb_hash(size, &head, &tail), format!("{size:016x}"));
    }

    #[test]
    fn osdb_hash_is_little_endian_and_wraps() {
        let mut head = vec![0u8; CHUNK as usize];
        // one word = 0x0000000000000001 (LE): first byte 1
        head[0] = 1;
        let tail = vec![0u8; CHUNK as usize];
        assert_eq!(osdb_hash(0, &head, &tail), format!("{:016x}", 1u64));
        // big-endian misread would give 0x0100000000000000 — ensure we don't.
        assert_ne!(osdb_hash(0, &head, &tail), format!("{:016x}", 1u64 << 56));
    }

    #[test]
    fn srt_to_vtt_basic() {
        let srt = "1\n00:00:01,000 --> 00:00:04,000\nHello & welcome\n\n2\n00:00:05,500 --> 00:00:08,000\n<i>World</i>\n";
        let vtt = serialize_cues(&parse_srt(srt), true, 0);
        assert!(vtt.starts_with("WEBVTT\n\n"));
        assert!(vtt.contains("0\n00:00:01.000 --> 00:00:04.000\nHello &amp; welcome\n\n"));
        assert!(vtt.contains("1\n00:00:05.500 --> 00:00:08.000\n<i>World</i>\n\n"));
        // <i> tags are NOT escaped; only &.
        assert!(!vtt.contains("&lt;i&gt;"));
    }

    #[test]
    fn srt_passthrough_uses_comma_and_no_header() {
        let srt = "1\n00:00:01,000 --> 00:00:04,000\nHi\n";
        let out = serialize_cues(&parse_srt(srt), false, 0);
        assert!(!out.starts_with("WEBVTT"));
        assert!(out.contains("00:00:01,000 --> 00:00:04,000"));
    }

    #[test]
    fn offset_shifts_every_cue() {
        let srt = "1\n00:00:01,000 --> 00:00:04,000\nHi\n";
        let out = serialize_cues(&parse_srt(srt), true, 1500);
        assert!(out.contains("00:00:02.500 --> 00:00:05.500"));
    }

    #[test]
    fn multiline_text_and_crlf() {
        let srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nline one\r\nline two\r\n\r\n";
        let cues = parse_srt(srt);
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text, "line one\nline two");
    }
}
