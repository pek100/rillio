<!--
id: streaming-server-rust-m3a-proxy
tags: [streaming-server, rust, proxy, m3u8, hls, ssrf, critical-path]
parent: docs/streaming-server-rust/README.md
milestone: M3a
status: spec
last_sync: 2026-07-08
sources_of_truth:
  - .research/server.js  (proprietary bundle; the behavioral oracle)
  - packages/video/src/withStreamingServer/convertStream.js  (JS caller)
  - crates/core/src/types/resource/stream.rs  (Rust caller)
-->

# M3a — `/proxy` subsystem: byte-exact spec

> **Why this has its own milestone.** `/proxy` is not a header shim. It is an HTTP
> forward-proxy *and* an HLS/`m3u8` playlist rewriter that sits on the critical path for
> **every non-torrent, direct-URL playback that carries proxy headers** (see caller
> analysis below). The playlist rewriter (server.js:71872-71912) is the single hardest
> atom in the whole streaming-server rewrite outside the torrent engine. Underestimating
> it is the flagged 3x-blowout risk.

All line citations are into the deobfuscated proprietary bundle
`F:\Projects\Code\Stremio\.research\server.js` unless another file is named.

---

## 0. Module map (what code implements this)

| Concern | Location |
|---|---|
| Router mounted at `/proxy` | server.js:46837 `enginefs.router.use("/proxy", proxy.getRouter())` |
| Proxy module header / imports | server.js:71798-71799 |
| Config constants (`cfgOpts`, header allowlists, playlist exts) | server.js:71799-71803 |
| Helpers (`ensureArray`, `makeHeaders`, `parseHeaderString`, `urlJoin`) | server.js:71804-71819 |
| Redirect follower | server.js:71820-71846 |
| Route handler + m3u8 rewriter | server.js:71847-71917 |
| JS URL builder (`buildProxyUrl`) | packages/video/src/withStreamingServer/convertStream.js:5-16 |
| JS routing decision (`proxyStreamsEnabled` \|\| `proxyHeaders`) | convertStream.js:47-53 |
| Rust URL builder | crates/core/src/types/resource/stream.rs:459-494 |
| Rust proxy-headers type | crates/core/src/types/resource/stream.rs:944-947 (`StreamProxyHeaders`) |

The module's Node imports (server.js:71798-71799) tell you the exact stdlib semantics the
Rust port must reproduce: `path` (`path.extname`), `url` (WHATWG-legacy `url.parse` /
`url.resolve` / `url.format`), **`querystring`** (Node's `querystring`, *not*
`URLSearchParams`), the Express `Router`, `stream.Transform`, `https` (agent), and
`node-fetch` (`fetch` + `Headers`).

---

## 1. URL FORMAT — `/proxy/:opts/:pathname(*)?`

### 1.1 Route grammar

```
router.all("/:opts/:pathname(*)?", handler)          // server.js:71852
```

Mounted under `/proxy` (server.js:46837), so the externally visible shape is:

```
/proxy/<opts>/<pathname...>?<search>
   |      |         |            |
   |      |         |            +-- verbatim query string of the TARGET url
   |      |         +-- target url path (may contain slashes: the (*) greedy segment)
   |      +-- ONE path segment: a urlencoded query-string blob (no raw '/')
   +-- fixed mount
```

`method` is **ALL** (`router.all`) — GET/HEAD/POST/etc. are all proxied; `req.method` is
forwarded verbatim (server.js:71824).

### 1.2 The `<opts>` blob — encoding

`<opts>` is a **`application/x-www-form-urlencoded` query string occupying a single path
segment**. It is *not* JSON and *not* base64. Keys (server.js:71799-71803):

| Key | Meaning | Cardinality |
|---|---|---|
| `d` | **Destination** = target **origin** only: `scheme://host[:port]` (no path) | exactly 1 |
| `h` | **Request header to inject**, formatted `"Name:Value"` | 0..n (repeated key) |
| `r` | **Response header to force**, formatted `"Name:Value"` | 0..n (repeated key) |

Decoded server-side with `querystring.parse(req.params.opts)` (server.js:71853). Repeated
`h`/`r` keys therefore decode to arrays; `ensureArray` (server.js:71804-71806, applied at
71854-71855) normalizes the single-value case to a 1-element array. Header value strings
are split on the **first** `:` only — `parseHeaderString` does `split(":")`, `shift()` for
the name, then `join(":")` for the value (server.js:71813-71816), so header values may
contain colons (e.g. a URL or `Date`).

Because `d`'s value contains `://`, it **must** be percent-encoded so the blob stays a
single Express path segment with no literal `/`. Both callers do this.

### 1.3 Caller A — `packages/video` (JS), convertStream.js:5-16

```js
function buildProxyUrl(streamingServerURL, streamURL, requestHeaders, responseHeaders) {
    var parsedStreamURL = new URL(streamURL);
    var proxyOptions = new URLSearchParams();
    proxyOptions.set('d', parsedStreamURL.origin);                       // origin = scheme://host[:port]
    Object.entries(requestHeaders).forEach(e => proxyOptions.append('h', e[0] + ':' + e[1]));
    Object.entries(responseHeaders).forEach(e => proxyOptions.append('r', e[0] + ':' + e[1]));
    return url.resolve(streamingServerURL, '/proxy/' + proxyOptions.toString()
                       + parsedStreamURL.pathname) + parsedStreamURL.search;
}
```

Note there is **no `/` inserted between the opts blob and `pathname`** here — it relies on
`pathname` beginning with `/` (WHATWG `URL.pathname` always starts with `/`). Result:
`/proxy/<opts>/<path>?<search>`. `search` (the target query, including `?`) is appended
*after* the whole thing. Invoked at convertStream.js:53, gated by
`proxyStreamsEnabled || proxyHeaders` (convertStream.js:47-50), where
`proxyHeaders = stream.behaviorHints.proxyHeaders` with `.request` / `.response` maps
(convertStream.js:48,51-52).

### 1.4 Caller B — `crates/core` (Rust), stream.rs:459-494

```rust
let mut proxy_query = form_urlencoded::Serializer::new(String::new());
let origin = format!("{}://{}", url.scheme(), url.authority());       // stream.rs:471
proxy_query.append_pair("d", origin.as_str());                        // :472
proxy_query.extend_pairs(request.iter().map(|h| ("h", format!("{}:{}", h.0, h.1))));  // :473-477
proxy_query.extend_pairs(response.iter().map(|h| ("r", format!("{}:{}", h.0, h.1)))); // :478-482
streaming_url.set_path(&format!(
    "proxy/{query}/{url_path}",
    query = proxy_query.finish().as_str(),
    url_path = &url.path().strip_prefix('/').unwrap_or(url.path()),   // :484-488
));
streaming_url.set_query(url.query());                                 // :490
```

Reached only for `StreamSource::Url { url }` with a non-`magnet` scheme, when
`behavior_hints.proxy_headers` is `Some` **and** a streaming-server URL is configured
(stream.rs:454, 459-463). The `url` has already been through `ftp_url_handler`
(stream.rs:455, defined :186) which rewrites `ftp://`/`ftps://` sources into a different
streaming-server route — so by :459 the scheme is http/https for real remote proxying.

### 1.5 Caller-identity: JS vs Rust — differences to reconcile

Both produce the same `/proxy/<form-urlencoded opts>/<path>?<query>` shape and both use
form-urlencoding, but two subtle divergences exist and the Rust **server** must accept
both (it decodes with Node `querystring`, which is lenient):

1. **Origin derivation.** JS uses `URL.origin` = `scheme://host[:port]`, which **omits
   userinfo**. Rust uses `format!("{}://{}", scheme, url.authority())` and
   `Url::authority()` **includes** any `user:pass@` userinfo (stream.rs:471). For a URL
   like `https://u:p@host/x`, JS emits `d=https://host`, Rust emits
   `d=https://u:p@host`. Practically streams don't carry userinfo, but the Rust *server*
   port should treat `d` as an opaque origin and `url::Url::parse` it — do not assume no
   userinfo.
2. **Space/encoding dialect.** `URLSearchParams.toString()` (JS) encodes space as `+`;
   `form_urlencoded::Serializer` (Rust core) also uses `+`; Node's `querystring.stringify`
   used *inside the rewriter* (server.js:71871,71884) encodes space as `%20`. All three
   round-trip through `querystring.parse`. The Rust port's decoder must accept `+` **and**
   `%20` as space in the opts segment.

### 1.6 Target reconstruction (server side)

server.js:71856-71859:

```js
var dest = url.parse(opts.d);                 // origin only
headers = Headers(makeHeaders(Headers(req.headers), proxyReqHeaders, { host: dest.host }));
dest.pathname = req.params.pathname || "";    // the greedy (*) segment
dest.search   = req.search || "";             // req.search includes leading '?'
```

So **target URL = `d` origin ⊕ `req.params.pathname` ⊕ `req.search`**. `url.format(dest)`
(server.js:71823) serializes it for the outbound `fetch`. Note `req.params.pathname` from
Express is **already URL-decoded once**; a faithful port must re-encode path segments when
rebuilding the outbound URL (reqwest/`url` will do this if you push decoded segments).

---

## 2. Outbound request + redirect following (≤5)

server.js:71820-71846, invoked at :71861.

### 2.1 Request header handling

- Start from the **client** request headers, filtered to the request allowlist
  `proxyReqHeaders` (server.js:71803):
  `["accept","accept-encoding","accept-language","connection","transfer-encoding","range","if-range","user-agent"]`.
  `makeHeaders` copies only those that are present (server.js:71807-71812).
- **Force `Host: <dest.host>`** as the default header (server.js:71857).
- Then **apply injected `h` headers** (`opts.h`), each `set` (overwrite) via
  `parseHeaderString` (server.js:71859-71860). Injected headers win over client headers.
- Everything else the client sent (cookies, auth, etc.) is **dropped** — only the 8
  allowlisted names plus injected `h` cross the boundary.

### 2.2 Fetch mode and redirect loop

- `fetch(url.format(dest), { method: req.method, headers, agent: httpsAgent,
  redirect: "manual" })` (server.js:71823-71828) — **manual** redirects; the module walks
  them itself.
- On a response with `status in [300,400)` **and** a `Location` header
  (server.js:71831-71833):
  - `dest` is recomputed as `url.parse(url.resolve(<origin-of-current-dest>, Location))`
    where the base is `dest.href` with its path and hash sliced off
    (server.js:71834) — i.e. **Location is resolved against the current destination's
    origin**, not the full path. Root-relative and absolute Locations work; a bare
    relative Location (`foo.m3u8`) would resolve against origin root (edge case — document
    but rare).
  - Headers are **rebuilt**: re-filter current `headers` through `proxyReqHeaders`,
    reset `Host` to the *new* dest host, and **re-apply the injected `h` headers**
    (server.js:71835-71838). Injected request headers therefore persist across every hop;
    `Host` tracks the current hop.
  - `redirectCount += 1` (server.js:71839).
- Loop while `redirectCount < 5` (server.js:71842). At `redirectCount >= 5`
  → `throw new Error("Too many redirects")` (server.js:71843), which reaches the handler
  `.catch` → `next(error)` (server.js:71914-71916) → Express error path (non-2xx).
- **Body is not read during redirect resolution**; only the final response body is piped.

### 2.3 Response header handling (final response)

server.js:71862-71866:

- Filter the final upstream response headers to the response allowlist `proxyResHeaders`
  (server.js:71803):
  `["accept-ranges","content-type","content-length","content-range","connection",
  "transfer-encoding","last-modified","etag","server","date"]`.
- Then apply injected `r` overrides (`opts.r`), each **assigned** (overwrite)
  (server.js:71863-71865).
- Status code is passed through unchanged (`res.writeHead(result.status, …)`
  server.js:71870).

---

## 3. m3u8 / mpegurl special case (the hard atom)

server.js:71867-71912.

### 3.1 Detection (server.js:71867)

```js
var isPlaylist =
    supportedPlaylists.includes(path.extname(dest.pathname))          // ".m3u" | ".m3u8"
    || (responseHeaders["content-type"] || "").toLowerCase().includes("mpegurl");
```

- `supportedPlaylists = [".m3u", ".m3u8"]` (server.js:71803). `path.extname` is
  **case-sensitive**, so `.M3U8` does *not* match by extension — but the content-type
  branch is lowercased and matches any type containing `mpegurl`
  (`application/vnd.apple.mpegurl`, `application/x-mpegurl`, `audio/mpegurl`, …).
- `dest.pathname` here is the **final** destination path (post-redirect), not the original
  request path.

### 3.2 Header mutations when `isPlaylist` (server.js:71868-71869)

- **Delete `content-length`** (body length changes after rewrite).
- Set `accept-ranges: none` (playlist is regenerated; ranges are meaningless).
- **Force chunked**: if `transfer-encoding` exists and doesn't already contain `chunked`,
  append `", chunked"`; otherwise set `transfer-encoding: chunked`.
- `res.writeHead(result.status, responseHeaders)` then stream through the rewriter.

### 3.3 `virtualRoot` — the rewrite anchor (server.js:71871)

```js
var virtualRoot = req.originalUrl.slice(0, -req.url.length) + "/" + querystring.stringify(opts);
```

- `req.originalUrl.slice(0, -req.url.length)` = the router **mount prefix** = `"/proxy"`
  (because the sub-router sees `req.url` relative to its mount).
- `querystring.stringify(opts)` re-serializes the **mutated** opts object — `h` and `r`
  are now arrays (from `ensureArray` at :71854-71855), so this emits
  `d=<origin>&h=<..>&h=<..>&r=<..>` with `%20`-style encoding.
- Result: `virtualRoot = "/proxy/d=<origin>&h=…&r=…"` — a **root-relative** path (no
  scheme/host). Every rewritten URL is emitted relative to this.

### 3.4 Line classification & rewrite rules

The transform (server.js:71889-71893) splits the body into lines (EOL auto-detected, see
3.6) and classifies each:

```
parseLine(line):
  if line does NOT start with '#'  AND line.length > 0:   return parseUrl(line)   // a URI line
  else:                                                    // comment/tag/blank
      m = line.match(/URI="([^"]+)"/)
      if m: return line.replace(m[1], parseUrl(m[1]))       // rewrite quoted URI in a tag
      else: return line                                     // pass through unchanged
```

So there are exactly **two** things rewritten: (a) a whole line that is a bare URI (a
segment/variant line), and (b) the first `URI="…"` attribute inside a `#EXT…` tag
(`#EXT-X-KEY`, `#EXT-X-MEDIA`, `#EXT-X-MAP`, `#EXT-X-SESSION-KEY`, `#EXT-X-I-FRAME-STREAM-INF`,
…). Only the **first** `URI="…"` per line is handled, via `String.replace` of the raw
substring (server.js:71892). Blank lines and non-URI tags pass through verbatim.

`parseUrl(line)` (server.js:71874-71888):

| Input line form | Output |
|---|---|
| `http://…` or `https://…`, **same** origin as `dest` (proto+host+port all equal) | `urlJoin([virtualRoot, lineUrl.pathname]) + lineUrl.search` → `/proxy/<opts>/<path>?<q>` (keeps original `d`/`h`/`r`) — server.js:71885 |
| `http://…` or `https://…`, **different** origin | `"/proxy/" + querystring.stringify(newOpts) + lineUrl.pathname + lineUrl.search` — a **freshly computed** opts blob (see 3.5) — server.js:71877-71884 |
| starts with `/` (root-relative) | `urlJoin([virtualRoot, line])` → `/proxy/<opts>/<line>` — server.js:71887 |
| anything else (bare relative, e.g. `seg001.ts`) | **returned unchanged** — server.js:71887 |

`urlJoin` = `segments.join("/").replace(/\/+/g, "/")` (server.js:71817-71819) — joins and
collapses duplicate slashes (so a leading `/` on `pathname` doesn't double up against
`virtualRoot`).

**Why leaving bare-relative URLs unchanged is correct:** the player fetched the playlist
*from* `/proxy/<opts>/<dir>/index.m3u8`, so a relative `seg001.ts` resolves in the client
against that proxy path → `/proxy/<opts>/<dir>/seg001.ts`, which the proxy maps straight
back to the origin's `<dir>/seg001.ts`. The proxy path deliberately mirrors the origin
path, so relative references keep working without rewriting.

### 3.5 Cross-origin sub-playlist opts recomputation (server.js:71877-71884)

For a URI whose origin differs from `dest`:

```js
var virtualRootArray = virtualRoot.split("/");
var currentHeaders   = ensureArray(querystring.parse(virtualRootArray.at(-1))[cfgOpts.DestinationHeader]); // the 'h' list
var newOpts = {
    d: lineUrl.protocol + "//" + lineUrl.host + (lineUrl.port ? ":" + lineUrl.port : ""),
    h: []
};
currentHeaders.forEach(h => newOpts.h.push(h));   // carry request headers forward
return "/proxy/" + querystring.stringify(newOpts) + lineUrl.pathname + lineUrl.search;
```

Key facts for the port:
- New `d` = the **sub-resource's** origin.
- **Request-header injection (`h`) is carried forward** from the current opts (parsed out
  of `virtualRoot`'s last segment).
- **Response-header overrides (`r`) are DROPPED** on cross-origin hops — `newOpts` has no
  `r`. Same-origin rewrites (3.4 row 1) keep `r` because they reuse `virtualRoot`.
  Reproduce this asymmetry exactly or oracle-diff will fail.
- `lineUrl.host` from Node `url.parse` already includes the port, so the extra
  `(lineUrl.port ? ":"+lineUrl.port : "")` **duplicates the port** (bug-for-bug:
  `host` = `example.com:8443` → `d=…//example.com:8443:8443`). This is a latent quirk in
  the original; decide explicitly whether to replicate. **Recommendation:** do *not*
  replicate the double-port bug — use just the origin — and cover it with a targeted
  oracle-diff carve-out note, because the container will emit the doubled port.

### 3.6 Streaming line splitter & EOL handling (server.js:71894-71911)

- A `stream.Transform` buffers a `partialLine` across chunks.
- EOL is detected **once**, from the first chunk that contains a `\n` or `\r`
  (server.js:71897-71900): resolves to `"\r\n"`, `"\n\r"`, `"\n"`, or `"\r"` and is reused
  for the rest of the stream (so mixed line endings normalize to the first-seen style on
  output).
- Each complete line → `parseLine(line) + eol` pushed; the trailing partial is retained
  (server.js:71901-71906).
- `flush` emits the final `partialLine` through `parseLine` with **no** trailing EOL
  (server.js:71908-71910).
- Chunk decoding uses `chunk.toString()` (default utf-8). A multibyte codepoint split
  across a chunk boundary can corrupt — negligible for ASCII playlists but note it; the
  Rust port should buffer bytes and split on `\n`/`\r` at the byte level, decoding
  per-line.

### 3.7 Recursion / nesting

There is **no explicit recursion** in the code. Nesting is handled **lazily by
re-entry**: a master playlist's variant URIs are rewritten to point back at `/proxy/…`;
when the player fetches a variant, that request hits the same handler, is re-detected as a
playlist (3.1), and rewritten again. Depth is unbounded across requests but each request
does exactly one pass. The port must therefore make the rewriter a pure per-request
function; nesting falls out of the routing.

---

## 4. `rejectUnauthorized: false` — the SSRF surface (server.js:71849-71851)

```js
var httpsAgent = new https.Agent({ rejectUnauthorized: !1 });   // TLS verification OFF
```

Passed as `agent` to every outbound `fetch` (server.js:71826). Combined with the fact that
`d` (destination origin) + path + injected headers are **fully attacker-controlled** (an
addon supplies `stream.url` and `stream.behaviorHints.proxyHeaders` → callers build the
proxy URL verbatim), this route is a classic **SSRF with TLS pinning disabled**:

- The server will fetch **any** origin the addon names, including
  `http://169.254.169.254/…` (cloud metadata), `http://127.0.0.1:<port>/…` (loopback
  services, including the streaming server's own control-plane routes), and RFC-1918
  hosts.
- `rejectUnauthorized:false` additionally means a MITM or a malicious host with an invalid
  cert is trusted — self-signed internal endpoints become reachable and un-authenticated.
- Redirects (§2.2) mean an allowed-looking origin can 3xx-bounce to an internal target.

### 4.1 Proposed Rust policy (do NOT blanket-disable TLS)

1. **TLS verification ON by default.** Use reqwest's default rustls verifier. Provide an
   *explicit, config-gated* opt-in
   (`proxy.allow_invalid_certs = ["host:port", …]`) — an **allowlist of exact
   `host[:port]` authorities**, never a global `danger_accept_invalid_certs(true)`.
   Rationale for keying on authority: the legitimate use case is a specific self-signed
   CDN/origin an operator knowingly trusts, which is identified by host.
2. **Destination allow/deny for SSRF.** Before connecting (and again after **every**
   redirect hop), resolve the destination host and **reject** if it maps to a private,
   loopback, link-local, unique-local, or CGNAT range unless the exact host is on an
   opt-in `proxy.allow_private_hosts` allowlist. Enforce at connect time, not just on the
   pre-resolution string, to defeat DNS-rebinding (pin the resolved IP through the
   request). Key the allowlist on **resolved IP CIDR + hostname**, not on the URL string.
3. **Scheme allowlist:** `http`, `https` only.
4. **Redirect cap = 5** (parity with server.js:71842) **and re-run the SSRF check on each
   `Location`** before following.
5. **Header injection guardrails:** strip hop-by-hop/forbidden headers from `h` (e.g. do
   not let `h` set `Host` to something that defeats the SNI/allowlist check; the original
   forces `Host: dest.host` and then lets `h` overwrite it — the port should let injected
   `Host` set the request `Host`/SNI but keep the SSRF check keyed on the *connected* IP).
6. Default posture: proxy **enabled only for the header-injection use case** the callers
   actually need (they only build proxy URLs when `proxyHeaders` are present, or
   `proxyStreamsEnabled` is set — convertStream.js:47-50). The SSRF checks above are the
   safety net around that.

---

## 5. Non-playlist passthrough (server.js:71913)

```js
else result.body.pipe(res);
```

For any non-playlist final response:

- **Body is streamed** straight through (no buffering) — `result.body.pipe(res)`.
- Response headers are exactly the allowlisted `proxyResHeaders` set (§2.3), **including**
  `content-length`, `content-range`, `accept-ranges`, `transfer-encoding` — so range
  responses pass through intact and the client sees the origin's `206`/`content-range`.
- **Range is propagated forward** because `range` and `if-range` are in `proxyReqHeaders`
  (server.js:71803) and copied from the client (§2.1); the origin's `206 Partial Content`
  + `Content-Range` come back through the response allowlist.
- Status code is the origin's (`res.writeHead(result.status, …)` at :71870).
- Headers **dropped**: everything not in the response allowlist — cookies
  (`set-cookie`), `cache-control`, `content-encoding` (note: **not** in the allowlist, so
  a gzip origin's `content-encoding` header is stripped while the body is passed through
  as-is — the client must not be told it's gzipped; verify against oracle whether upstream
  is requested with `accept-encoding: identity` — `accept-encoding` *is* forwarded from the
  client, so behavior depends on the client. Flag this in oracle-diff.), CORS headers,
  `x-*`, etc.

---

## 6. Rust implementation sketch (axum + reqwest)

### 6.1 Crate deps

```toml
reqwest       = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
axum          = { version = "0.7", features = ["http2"] }
http          = "1"
bytes         = "1"
futures-util  = "0.3"                 # StreamExt for body streaming
tokio         = { version = "1", features = ["io-util"] }
tokio-util    = { version = "0.7", features = ["io"] }   # ReaderStream / codec
form_urlencoded = "1"                 # decode <opts>; also used by core (parity)
url           = "2"
ipnet / ip_network = "*"              # SSRF CIDR checks (§4.1)
mime          = "0.3"                 # optional, for content-type matching
```

Redirect policy: **`reqwest::redirect::Policy::none()`** and follow manually (mirrors
`redirect: "manual"`), so the SSRF re-check (§4.1) runs on every hop.

### 6.2 Handler skeleton

```rust
// GET/POST/... /proxy/{opts}/{*path}
async fn proxy_handler(
    State(cfg): State<ProxyConfig>,
    method: Method,
    OriginalUri(original): OriginalUri,       // to recompute virtual_root
    Path((opts_raw, tail)): Path<(String, String)>,   // tail = the *path glob (may be "")
    headers: HeaderMap,
    req_body: Body,                            // forwarded for non-GET
) -> Result<Response, ProxyError> {
    let opts = ProxyOpts::parse(&opts_raw)?;   // { d: Url(origin), h: Vec<(String,String)>, r: Vec<(String,String)> }
    let target = build_target(&opts.d, &tail, original.query())?;   // origin ⊕ path ⊕ ?query
    ssrf_guard(&cfg, &target)?;                                     // §4.1 (resolve + CIDR check)

    let (resp, final_url) = fetch_following_redirects(&cfg, &method, target, &headers, &opts).await?; // §6.3

    // response headers -> allowlist + injected r
    let mut out = filtered_res_headers(resp.headers(), RES_ALLOW);
    apply_injected(&mut out, &opts.r);

    let is_playlist = is_m3u8(final_url.path()) || ct_has_mpegurl(&out);
    if is_playlist {
        out.remove(CONTENT_LENGTH);
        out.insert(ACCEPT_RANGES, HeaderValue::from_static("none"));
        force_chunked(&mut out);
        let virtual_root = format!("/proxy/{}", opts.reencode());    // §3.3
        let body = rewrite_playlist_stream(resp.bytes_stream(), virtual_root, opts.d.clone());
        Ok(build_response(resp.status(), out, Body::from_stream(body)))
    } else {
        Ok(build_response(resp.status(), out, Body::from_stream(resp.bytes_stream())))  // passthrough
    }
}
```

### 6.3 Redirect follower (manual, ≤5, SSRF re-checked)

```rust
async fn fetch_following_redirects(
    cfg: &ProxyConfig, method: &Method, mut target: Url,
    client_headers: &HeaderMap, opts: &ProxyOpts,
) -> Result<(reqwest::Response, Url), ProxyError> {
    let mut hops = 0;
    loop {
        let mut req_headers = filtered_req_headers(client_headers, REQ_ALLOW);   // §2.1
        req_headers.insert(HOST, HeaderValue::from_str(target.authority())?);
        apply_injected(&mut req_headers, &opts.h);
        let resp = cfg.client(&target)                     // picks TLS verifier per §4.1 allowlist
            .request(method.clone(), target.clone())
            .headers(req_headers)
            .send().await?;
        if resp.status().is_redirection() {
            if let Some(loc) = resp.headers().get(LOCATION) {
                let base = origin_of(&target);             // strip path+hash (server.js:71834)
                target = base.join(loc.to_str()?)?;
                ssrf_guard(cfg, &target)?;                 // re-check every hop
                hops += 1;
                if hops >= 5 { return Err(ProxyError::TooManyRedirects); }  // server.js:71843
                continue;
            }
        }
        return Ok((resp, target));
    }
}
```

### 6.4 The playlist rewriter — standalone, pure function

Signature (keep it isolated + unit-testable against captured playlist fixtures):

```rust
/// Rewrite one HLS/m3u playlist so every absolute/rooted URL is routed back through
/// `/proxy`. `virtual_root` is "/proxy/<reencoded-opts>"; `dest_origin` is the playlist's
/// own origin (used to decide same- vs cross-origin per line).
/// Streaming variant: operates on a byte stream, buffers by line, preserves first-seen EOL.
fn rewrite_playlist_stream<S>(
    upstream: S,
    virtual_root: String,
    dest_origin: Url,
) -> impl Stream<Item = Result<Bytes, ProxyError>>
where S: Stream<Item = reqwest::Result<Bytes>>;

/// Pure per-line core (unit-tested directly):
fn rewrite_line(line: &str, virtual_root: &str, dest_origin: &Url) -> String;   // §3.4
fn rewrite_uri (uri:  &str, virtual_root: &str, dest_origin: &Url) -> String;   // §3.4/3.5 parseUrl
```

`rewrite_line` mirrors `parseLine` (§3.4): `#`-lines → only `URI="…"` rewritten (first
match, substring replace); non-`#` non-empty lines → `rewrite_uri`; blanks unchanged.
`rewrite_uri` mirrors `parseUrl`: same-origin absolute → `virtual_root ⊕ path?q` (collapse
`//`); cross-origin absolute → fresh `/proxy/<d=..&h=..>path?q` carrying `h` forward and
**dropping `r`** (§3.5); rooted `/…` → `virtual_root ⊕ line`; bare relative → unchanged.
Implement the EOL detection (`\r\n`/`\n\r`/`\n`/`\r`, first-seen wins) and cross-chunk
partial-line buffering from §3.6.

**Decision points to lock before coding** (each is an oracle-diff footgun):
- double-port quirk (§3.5) — recommend *fixing*, note the carve-out;
- `content-encoding` stripping vs body passthrough (§5);
- opts re-encoding dialect: match Node `querystring.stringify` (`%20`, `&`-joined,
  repeated keys for arrays) so rewritten URLs are byte-identical to the container's.

---

## 7. Oracle-diff test recipe

Goal: prove the Rust `/proxy` rewrites playlist bodies **byte-for-byte** identical to the
container. Harness is the same "same request → both servers → diff" pattern the README
mandates (README.md:39-43).

### 7.1 Fixtures

Use a stable master+variant HLS asset. Two tiers:
1. **Hermetic (preferred):** stand up a local origin (e.g. a static file server on
   `127.0.0.1:9000`) serving a hand-authored master `index.m3u8` that exercises every
   branch: (a) same-origin variant line, (b) cross-origin variant (`http://cdn2.local:8443/…`),
   (c) root-relative segment `/seg/hi.ts`, (d) bare-relative segment `seg/lo.ts`,
   (e) `#EXT-X-KEY:...,URI="https://cdn2.local/key.bin"`, (f) `#EXT-X-MAP:URI="init.mp4"`,
   (g) CRLF and LF variants, (h) a trailing line with no EOL. Because the origin is
   loopback, add both `127.0.0.1:9000` and `cdn2.local` to the **test-only**
   `allow_private_hosts` list so the Rust SSRF guard permits them.
2. **Live smoke (optional, flaky):** a real public `.m3u8` behind `proxyHeaders`.

### 7.2 Procedure

```
BASE_C=http://127.0.0.1:11470      # container oracle (docker/streaming-server)
BASE_R=http://127.0.0.1:11480      # rust server under test
OPTS='d=http%3A%2F%2F127.0.0.1%3A9000'            # + any h=/r= you want to assert
PATH='hls/index.m3u8'

# 1. Build identical proxy URLs
curl -s "$BASE_C/proxy/$OPTS/$PATH" > c.m3u8
curl -s "$BASE_R/proxy/$OPTS/$PATH" > r.m3u8

# 2. Byte-diff the rewritten body
diff <(xxd c.m3u8) <(xxd r.m3u8)      # MUST be empty

# 3. Assert the playlist-specific header mutations on BOTH:
#    - no content-length, accept-ranges: none, transfer-encoding contains chunked  (§3.2)
for B in $BASE_C $BASE_R; do
  curl -sD - -o /dev/null "$B/proxy/$OPTS/$PATH" \
    | grep -iE 'content-length|accept-ranges|transfer-encoding'
done

# 4. Follow one rewritten cross-origin line and re-diff (proves recursion parity)
#    extract a /proxy/... line from c.m3u8, GET it on both, diff again.

# 5. Non-playlist passthrough: request a .ts segment with Range, assert 206 +
#    content-range identical on both, body bytes identical.
curl -sD - -H 'Range: bytes=0-1023' "$BASE_C/proxy/$OPTS/hls/seg001.ts" -o cseg
curl -sD - -H 'Range: bytes=0-1023' "$BASE_R/proxy/$OPTS/hls/seg001.ts" -o rseg
cmp cseg rseg
```

### 7.3 Assertions

- **A1** rewritten master body byte-identical (step 2). This is the primary gate.
- **A2** playlist header mutations identical (step 3).
- **A3** cross-origin variant, when fetched, is itself rewritten identically (step 4) —
  proves the lazy-recursion model (§3.7) and the `h`-carried/`r`-dropped rule (§3.5).
- **A4** non-playlist Range passthrough: status, `content-range`, body all identical
  (step 5) — proves §5.
- **Known carve-outs to encode as explicit xfail/normalized comparisons:** the double-port
  quirk (§3.5) if you choose to fix it; `content-encoding` handling (§5). Document each in
  the test so a diff there is a *known* divergence, not a regression.

### 7.4 In-repo harness note

Wire this into the existing oracle-diff harness (decomposition.md:20 — "oracle-diff test
harness: same req → container vs self"). The container must be the one built in
`926a556 / 85f7f41` (`docker/streaming-server`, answers on `:11470`).

---

## 8. Parity checklist (implementation gate)

- [ ] `<opts>` decodes with `h`/`r` as repeatable keys; accepts `+` and `%20` for space (§1.2, §1.5).
- [ ] target = `d` ⊕ path ⊕ query; path re-encoded from Express-decoded segment (§1.6).
- [ ] request headers filtered to the 8-name allowlist, `Host` forced, `h` overrides applied (§2.1).
- [ ] manual redirects, ≤5, `Host` re-set per hop, `h` re-applied, Location resolved against origin (§2.2).
- [ ] `>=5` redirects → error/non-2xx (§2.2).
- [ ] response headers filtered to the 9-name allowlist, `r` overrides applied (§2.3).
- [ ] playlist detection: `.m3u`/`.m3u8` ext (case-sensitive) OR content-type contains `mpegurl` (§3.1).
- [ ] playlist: drop content-length, `accept-ranges: none`, force chunked (§3.2).
- [ ] rewriter: same-origin/cross-origin/rooted/relative rules + `URI="…"` in tags (§3.4).
- [ ] cross-origin recompute carries `h`, drops `r` (§3.5); decide double-port quirk (§3.5).
- [ ] EOL auto-detect + cross-chunk partial buffering + no trailing EOL on flush (§3.6).
- [ ] non-playlist streamed passthrough with Range/`content-range` intact (§5).
- [ ] TLS verify ON by default; SSRF allow/deny keyed on resolved IP + host, re-checked per hop (§4.1).
- [ ] oracle-diff A1–A4 green (§7).
