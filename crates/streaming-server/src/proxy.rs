//! M3a — the `/proxy` subsystem.
//!
//! An HTTP forward-proxy (header injection for addon streams) that ALSO rewrites
//! HLS/`m3u8` playlists so every absolute/rooted URL inside them routes back
//! through `/proxy`. On the critical path for every non-torrent direct-URL
//! stream carrying proxy headers. Byte-behavior mirrors server.js:71798-71917;
//! see docs/streaming-server-rust/specs/03-proxy-subsystem.md.
//!
//! Deliberate deviations from the blob (documented, not accidental):
//! - TLS verification stays ON; the blob used `rejectUnauthorized:false`. We add
//!   an SSRF guard (block private/loopback ranges unless allowlisted) instead.
//! - The cross-origin sub-playlist `d` does NOT duplicate the port (a blob bug).
//! - Playlists are buffered then rewritten (they are small) rather than streamed
//!   line-by-line; output is equivalent. Non-playlist bodies stream through.

use axum::body::Body;
use axum::extract::{OriginalUri, Path, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use url::Url;

use crate::config::Config;
use crate::ssrf::{self, Policy};

/// Client request headers allowed to cross to the origin (server.js:71803).
const REQ_ALLOW: &[&str] = &[
    "accept",
    "accept-encoding",
    "accept-language",
    "connection",
    "transfer-encoding",
    "range",
    "if-range",
    "user-agent",
];

/// Origin response headers allowed back to the client (server.js:71803).
///
/// NOTE: the blob's allowlist also includes `connection` and `transfer-encoding`;
/// we omit them because they are hop-by-hop headers that hyper frames itself —
/// forwarding or hand-setting them produces an invalid response. hyper computes
/// content-length / chunked framing for the body we return.
const RES_ALLOW: &[&str] = &[
    "accept-ranges",
    "content-type",
    "content-length",
    "content-range",
    "last-modified",
    "etag",
    "server",
    "date",
];

const MAX_REDIRECTS: u32 = 5;

/// Parsed `<opts>` blob: `d` (destination origin), `h`/`r` = "Name:Value" header
/// directives (repeatable). `form_urlencoded::parse` accepts `+` and `%20`.
struct ProxyOpts {
    d: String,
    h: Vec<String>,
    r: Vec<String>,
}

impl ProxyOpts {
    fn parse(raw: &str) -> Option<Self> {
        let mut d = None;
        let mut h = Vec::new();
        let mut r = Vec::new();
        for (k, v) in form_urlencoded::parse(raw.as_bytes()) {
            match k.as_ref() {
                "d" => d = Some(v.into_owned()),
                "h" => h.push(v.into_owned()),
                "r" => r.push(v.into_owned()),
                _ => {}
            }
        }
        d.map(|d| Self { d, h, r })
    }

    /// Re-encode as a querystring for `virtual_root` (%20 for space, `&`-joined,
    /// repeated keys). Mirrors Node `querystring.stringify` (server.js:71871).
    fn reencode(&self) -> String {
        let mut parts = vec![format!("d={}", qs(&self.d))];
        for h in &self.h {
            parts.push(format!("h={}", qs(h)));
        }
        for r in &self.r {
            parts.push(format!("r={}", qs(r)));
        }
        parts.join("&")
    }
}

/// Percent-encode a querystring component, space as `%20` (querystring-style).
fn qs(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~'
                if !(b > b'Z' && b < b'a') =>
            {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Split a "Name:Value" directive on the first colon (server.js:71813-71816).
fn split_header(s: &str) -> Option<(HeaderName, HeaderValue)> {
    let (name, value) = s.split_once(':')?;
    let name = HeaderName::from_bytes(name.trim().as_bytes()).ok()?;
    let value = HeaderValue::from_str(value.trim()).ok()?;
    Some((name, value))
}

fn err(status: StatusCode) -> Response {
    status.into_response()
}

/// `ALL /proxy/{opts}/{*path}` — with a trailing path.
pub(crate) async fn proxy_with_path(
    cfg: State<Config>,
    method: Method,
    uri: OriginalUri,
    Path((opts, tail)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    handle(cfg.0, method, uri, opts, tail, headers, body).await
}

/// `ALL /proxy/{opts}` — no trailing path (target is the origin root).
pub(crate) async fn proxy_root(
    cfg: State<Config>,
    method: Method,
    uri: OriginalUri,
    Path(opts): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    handle(cfg.0, method, uri, opts, String::new(), headers, body).await
}

#[allow(clippy::too_many_arguments)]
async fn handle(
    cfg: Config,
    method: Method,
    OriginalUri(original): OriginalUri,
    opts_raw: String,
    tail: String,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Some(opts) = ProxyOpts::parse(&opts_raw) else {
        return err(StatusCode::BAD_REQUEST);
    };
    // target = d-origin ⊕ path ⊕ query
    let Ok(mut target) = Url::parse(&opts.d) else {
        return err(StatusCode::BAD_REQUEST);
    };
    target.set_path(&format!("/{}", tail.trim_start_matches('/')));
    target.set_query(original.query());

    // Collect the request body once (proxied verbatim for non-GET).
    let body_bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap_or_default();

    let fetched = fetch_following_redirects(&cfg, &method, target, &headers, &opts, body_bytes).await;
    let (resp, final_url) = match fetched {
        Ok(v) => v,
        Err(status) => return err(status),
    };

    let status = resp.status();
    let mut out = filtered_headers(resp.headers(), RES_ALLOW);
    apply_directives(&mut out, &opts.r); // injected `r` overrides

    let is_playlist = is_m3u8(final_url.path()) || ct_has_mpegurl(&out);
    if is_playlist {
        // Body length changes after rewrite: drop the stale content-length and
        // let hyper reframe. Ranges are meaningless on a regenerated playlist.
        out.remove(header::CONTENT_LENGTH);
        out.insert(header::ACCEPT_RANGES, HeaderValue::from_static("none"));
        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(_) => return err(StatusCode::BAD_GATEWAY),
        };
        let virtual_root = format!("/proxy/{}", opts.reencode());
        let origin = origin_of(&final_url);
        let rewritten = rewrite_playlist(&String::from_utf8_lossy(&bytes), &virtual_root, &origin, &opts.h);
        return (status, out, rewritten).into_response();
    }

    // Non-playlist: stream the body through.
    let stream = resp.bytes_stream().map(|r| r.map_err(std::io::Error::other));
    (status, out, Body::from_stream(stream)).into_response()
}

/// Fetch `target`, following ≤5 redirects manually, re-vetting SSRF on each hop
/// and re-applying injected `h` headers + `Host` per hop. Each hop uses a client
/// pinned to the hop's vetted IP (resolve-then-connect), so a rebinding DNS answer
/// cannot slip a private address past the check.
async fn fetch_following_redirects(
    cfg: &Config,
    method: &Method,
    mut target: Url,
    client_headers: &HeaderMap,
    opts: &ProxyOpts,
    body: bytes::Bytes,
) -> Result<(reqwest::Response, Url), StatusCode> {
    let mut hops = 0u32;
    loop {
        // Vet the destination and pin the connection to it. The proxy never talks
        // to private/loopback ranges (Strict), unlike the subtitle routes.
        let client = ssrf::vet_and_pin(cfg, &target, Policy::Strict).await?;

        let mut req_headers = filtered_headers(client_headers, REQ_ALLOW);
        if let Some(host) = target.host_str() {
            let host_val = match target.port() {
                Some(p) => format!("{host}:{p}"),
                None => host.to_owned(),
            };
            if let Ok(v) = HeaderValue::from_str(&host_val) {
                req_headers.insert(header::HOST, v);
            }
        }
        apply_directives(&mut req_headers, &opts.h); // injected `h` win

        let reqwest_method = reqwest::Method::from_bytes(method.as_str().as_bytes())
            .map_err(|_| StatusCode::BAD_REQUEST)?;
        let resp = client
            .request(reqwest_method, target.clone())
            .headers(to_reqwest_headers(&req_headers))
            .body(body.clone())
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;

        if resp.status().is_redirection() {
            if let Some(loc) = resp.headers().get(reqwest::header::LOCATION) {
                let loc = loc.to_str().map_err(|_| StatusCode::BAD_GATEWAY)?;
                // Resolve against the current destination's ORIGIN (server.js:71834).
                let base = origin_of(&target);
                target = base.join(loc).map_err(|_| StatusCode::BAD_GATEWAY)?;
                hops += 1;
                if hops >= MAX_REDIRECTS {
                    return Err(StatusCode::BAD_GATEWAY); // "Too many redirects"
                }
                continue;
            }
        }
        return Ok((resp, target));
    }
}

// ---------------------------------------------------------------------------
// Playlist rewriter (the hard atom). Pure functions, exhaustively unit-tested.
// ---------------------------------------------------------------------------

fn is_m3u8(path: &str) -> bool {
    // path.extname, case-sensitive (server.js:71867).
    path.ends_with(".m3u8") || path.ends_with(".m3u")
}

fn ct_has_mpegurl(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_lowercase().contains("mpegurl"))
        .unwrap_or(false)
}

/// Rewrite a whole playlist. Detects the first-seen EOL and preserves it.
fn rewrite_playlist(body: &str, virtual_root: &str, dest_origin: &Url, h: &[String]) -> String {
    let eol = detect_eol(body);
    body.split(eol)
        .map(|line| rewrite_line(line, virtual_root, dest_origin, h))
        .collect::<Vec<_>>()
        .join(eol)
}

fn detect_eol(body: &str) -> &'static str {
    if body.contains("\r\n") {
        "\r\n"
    } else if body.contains("\n\r") {
        "\n\r"
    } else if body.contains('\n') {
        "\n"
    } else if body.contains('\r') {
        "\r"
    } else {
        "\n"
    }
}

/// Per-line rule (server.js parseLine): a bare non-`#` non-empty line is a URI;
/// a `#EXT…` tag has only its first `URI="…"` rewritten; blanks pass through.
fn rewrite_line(line: &str, virtual_root: &str, dest_origin: &Url, h: &[String]) -> String {
    if !line.starts_with('#') && !line.is_empty() {
        return rewrite_uri(line, virtual_root, dest_origin, h);
    }
    // Rewrite the first URI="..." inside a tag, if present.
    if let Some(start) = line.find("URI=\"") {
        let after = start + 5;
        if let Some(end_rel) = line[after..].find('"') {
            let uri = &line[after..after + end_rel];
            let rewritten = rewrite_uri(uri, virtual_root, dest_origin, h);
            return format!("{}{}{}", &line[..after], rewritten, &line[after + end_rel..]);
        }
    }
    line.to_owned()
}

/// Per-URI rule (server.js parseUrl).
fn rewrite_uri(uri: &str, virtual_root: &str, dest_origin: &Url, h: &[String]) -> String {
    if let Ok(abs) = Url::parse(uri) {
        if matches!(abs.scheme(), "http" | "https") {
            let same_origin = origin_of(&abs) == *dest_origin;
            let path_q = path_and_query(&abs);
            if same_origin {
                // keep original opts (virtual_root already carries d/h/r)
                return url_join(virtual_root, &path_q);
            }
            // cross-origin: fresh opts carrying `h`, dropping `r` (server.js:71877-71884)
            let mut opts = format!("d={}", qs(&origin_string(&abs)));
            for hv in h {
                opts.push_str(&format!("&h={}", qs(hv)));
            }
            return format!("/proxy/{opts}{path_q}");
        }
    }
    if uri.starts_with('/') {
        return url_join(virtual_root, uri);
    }
    // bare relative → unchanged (resolves against the proxy path in the client)
    uri.to_owned()
}

/// `segments.join("/")` then collapse duplicate slashes (server.js:71817-71819),
/// preserving the query string.
fn url_join(root: &str, path: &str) -> String {
    let (path_only, query) = match path.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (path, None),
    };
    let joined = format!("{root}/{path_only}");
    let collapsed = collapse_slashes(&joined);
    match query {
        Some(q) => format!("{collapsed}?{q}"),
        None => collapsed,
    }
}

fn collapse_slashes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_slash = false;
    for c in s.chars() {
        if c == '/' {
            if !prev_slash {
                out.push(c);
            }
            prev_slash = true;
        } else {
            out.push(c);
            prev_slash = false;
        }
    }
    out
}

/// `scheme://host[:port]` as a normalized `Url` for origin comparison.
fn origin_of(u: &Url) -> Url {
    let mut o = u.clone();
    o.set_path("");
    o.set_query(None);
    o.set_fragment(None);
    o
}

fn origin_string(u: &Url) -> String {
    // scheme://host[:port] — no double port (blob bug deliberately not replicated).
    match u.port() {
        Some(p) => format!("{}://{}:{}", u.scheme(), u.host_str().unwrap_or(""), p),
        None => format!("{}://{}", u.scheme(), u.host_str().unwrap_or("")),
    }
}

fn path_and_query(u: &Url) -> String {
    match u.query() {
        Some(q) => format!("{}?{}", u.path(), q),
        None => u.path().to_owned(),
    }
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

fn filtered_headers(headers: &HeaderMap, allow: &[&str]) -> HeaderMap {
    let mut out = HeaderMap::new();
    for name in allow {
        if let Some(v) = headers.get(*name) {
            if let Ok(hn) = HeaderName::from_bytes(name.as_bytes()) {
                out.insert(hn, v.clone());
            }
        }
    }
    out
}

fn apply_directives(headers: &mut HeaderMap, directives: &[String]) {
    for d in directives {
        if let Some((name, value)) = split_header(d) {
            headers.insert(name, value); // overwrite
        }
    }
}

fn to_reqwest_headers(headers: &HeaderMap) -> reqwest::header::HeaderMap {
    let mut out = reqwest::header::HeaderMap::new();
    for (k, v) in headers {
        if let (Ok(name), Ok(val)) = (
            reqwest::header::HeaderName::from_bytes(k.as_str().as_bytes()),
            reqwest::header::HeaderValue::from_bytes(v.as_bytes()),
        ) {
            out.append(name, val);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn opts_parse_and_reencode() {
        let o = ProxyOpts::parse("d=https%3A%2F%2Fcdn.example.com&h=User-Agent%3AFoo&r=Cache-Control%3Ano-store").unwrap();
        assert_eq!(o.d, "https://cdn.example.com");
        assert_eq!(o.h, vec!["User-Agent:Foo"]);
        assert_eq!(o.r, vec!["Cache-Control:no-store"]);
        // reencode round-trips through parse
        let again = ProxyOpts::parse(&o.reencode()).unwrap();
        assert_eq!(again.d, o.d);
        assert_eq!(again.h, o.h);
        assert_eq!(again.r, o.r);
    }

    const VR: &str = "/proxy/d=https%3A%2F%2Fcdn.example.com";

    #[test]
    fn same_origin_absolute_reuses_virtual_root() {
        let dest = origin("https://cdn.example.com");
        let got = rewrite_uri("https://cdn.example.com/hls/720/seg1.ts?t=5", VR, &dest, &[]);
        assert_eq!(got, "/proxy/d=https%3A%2F%2Fcdn.example.com/hls/720/seg1.ts?t=5");
    }

    #[test]
    fn cross_origin_absolute_gets_fresh_opts_and_carries_h_drops_r() {
        let dest = origin("https://cdn.example.com");
        let h = vec!["Authorization:Bearer xyz".to_owned()];
        let got = rewrite_uri("https://cdn2.other.com:8443/v/key.bin", VR, &dest, &h);
        assert!(got.starts_with("/proxy/d=https%3A%2F%2Fcdn2.other.com%3A8443"));
        assert!(got.contains("h=Authorization%3ABearer"));
        assert!(!got.contains("r="), "response overrides dropped cross-origin");
        assert!(got.ends_with("/v/key.bin"));
        // no double port
        assert!(!got.contains("8443%3A8443") && !got.contains("8443:8443"));
    }

    #[test]
    fn root_relative_joins_virtual_root() {
        let dest = origin("https://cdn.example.com");
        assert_eq!(rewrite_uri("/seg/hi.ts", VR, &dest, &[]), format!("{VR}/seg/hi.ts"));
    }

    #[test]
    fn bare_relative_unchanged() {
        let dest = origin("https://cdn.example.com");
        assert_eq!(rewrite_uri("seg001.ts", VR, &dest, &[]), "seg001.ts");
    }

    #[test]
    fn uri_attribute_in_tag_rewritten() {
        let dest = origin("https://cdn.example.com");
        let line = "#EXT-X-KEY:METHOD=AES-128,URI=\"https://cdn.example.com/key.bin\",IV=0x1";
        let got = rewrite_line(line, VR, &dest, &[]);
        assert_eq!(
            got,
            "#EXT-X-KEY:METHOD=AES-128,URI=\"/proxy/d=https%3A%2F%2Fcdn.example.com/key.bin\",IV=0x1"
        );
    }

    #[test]
    fn comment_and_blank_pass_through() {
        let dest = origin("https://cdn.example.com");
        assert_eq!(rewrite_line("#EXTM3U", VR, &dest, &[]), "#EXTM3U");
        assert_eq!(rewrite_line("", VR, &dest, &[]), "");
    }

    #[test]
    fn full_playlist_preserves_structure_and_eol() {
        let dest = origin("https://cdn.example.com");
        let body = "#EXTM3U\r\n#EXT-X-STREAM-INF:BANDWIDTH=1\r\nhttps://cdn.example.com/v/720.m3u8\r\nseg.ts\r\n";
        let got = rewrite_playlist(body, VR, &dest, &[]);
        assert!(got.contains("\r\n"), "CRLF preserved");
        assert!(got.contains("/proxy/d=https%3A%2F%2Fcdn.example.com/v/720.m3u8"));
        assert!(got.contains("\nseg.ts\r\n") || got.ends_with("seg.ts\r\n"));
    }
}
