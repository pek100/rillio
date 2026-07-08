<!--
id: streaming-server-rust-spec-04
tags: [streaming-server, rust, archives, opensubhash, srt-vtt, tracks, yt, spec]
related_files:
  - .research/server.js
  - crates/core/src/types/resource/stream.rs
  - crates/core/src/types/streaming_server/request.rs
  - packages/video/src/tracksData.js
  - packages/video/src/withHTMLSubtitles/withHTMLSubtitles.js
milestones: [M5, M3b]
status: spec
last_sync: 2026-07-08
-->

# Spec 04 — Archives (M5) + non-ffmpeg Support Algorithms (M3b)

Byte-exact implementation spec. Every claim cites `file:line`. All `server.js` line
numbers refer to `F:\Projects\Code\Stremio\.research\server.js` (the proprietary bundle).
The oracle for diff-testing is the running container on `:11470`.

Reader's map of the two archive route *shapes* (they are NOT uniform — do not assume one
handler covers all seven formats):

| Format | Module (create router) | Stream route | Key handler | Range semantics |
|---|---|---|---|---|
| zip | `104892` | `GET /stream` (key in query) | shared `104817` | true byte-range via offset math (stored only) |
| rar | `97477` | `GET /stream` (key in query) | `1231` (`97479`) | inner-lib seek |
| 7zip | `108519` | `GET /stream` (key in query) | `1290` (`108521`) | inner-lib seek |
| tar | `109488` | `GET /stream` (key in query) | `1297` (`109489`) | inner-lib seek |
| tgz | `110095` | `GET /stream` (key in query) | `1304` (`110097`) | inner-lib seek |
| nzb | `96033` | `GET /stream/:key/:fileName` (path) | inline `createKeyHandler` | supportsSeek-gated |
| ftp | `110775` | `GET /stream/:key/:fileName` (path) + `ALL /:fileName` | inline `createKeyHandler` | supportsSeek-gated |

Rider #5 in the README ("`GET /stream/:key/:fileName`") describes the **nzb/ftp** shape.
The five true archive formats (zip/rar/7zip/tar/tgz) actually use **`GET /stream?key=`**.
Both shapes share the same `POST /create/:createKey` + `ALL /create` registration idea.

---

# PART A — ARCHIVES (M5)

## A.1 The key handshake (state machine)

Archives are a **stateful 2-step protocol**, not a single GET. Reference impl for zip is
the router at `server.js:104895-105010`; the shared key handler is at
`server.js:104817-104871`.

### Route registration (zip, `server.js:104897-104898`)

```
router.use(bodyParser.json())
router.post("/create/:createKey", keyHandler.createKey.bind(null,"zip", orderRegex, 99999))
router.all ("/create",            keyHandler.createKey.bind(null,"zip", orderRegex, 99999))
router.get ("/stream",            <stream handler>)
```

`keyHandler.createKey` is curried with `(archiveType, orderRegex, orderDefault)`
(`server.js:104819`). Per-format currying differs (see A.5).

### State: the in-memory key store

`store = __webpack_require__(162)` (`server.js:104817`) is a process-global
key→value map. `store.set(arr, key?)` returns a key (generated if none passed);
`store.get(key)` returns `null` when absent (`server.js:104821`, `104831`, `104866`,
`104936`). This is the shared registration table.

`initEmitter` is a single global `EventEmitter` (`server.js:104817`); registering a key
emits an event named after the key (`server.js:104832`). This is the wakeup channel for
`waitForKey`.

### Step 1a — POST registration (`server.js:104834-104842`)

- Body **must** be a JSON array, else `500 text/plain "Cannot parse JSON data, err 1"`
  (`server.js:104835`).
- `storeDataToKey(body, req.params.createKey)`:
  - normalizes each element (`server.js:104822-104827`): array `[url, bytes]` →
    `{url, bytes}`; `[url]` or `[url,0]` → `{url}`; falsy first element dropped.
  - if `orderRegex` present, **sorts** the url list by the numeric capture group of
    `url.split("?")[0].match(orderRegex)`, defaulting to `orderDefault`
    (`server.js:104827-104830`). This is multi-volume ordering (`.Z01`, `.Z02` …).
  - `store.set(arr, newKey)` then `initEmitter.emit(key)` (`server.js:104831-104832`).
  - Idempotency: if `newKey` already resolves, it is returned unchanged
    (`server.js:104821`).
- Response: `application/json` `{"key": "<key>"}` with an explicit `Content-Length`
  (`server.js:104838-104842`).

### Step 1b — GET registration via `?lz=` (`server.js:104843-104859`) — the path core uses

`crates/core` never POSTs; it emits a `GET .../zip/create?lz=<compressed>` URL and lets the
player fetch it (`crates/core/src/types/resource/stream.rs:284-304`). That GET hits the
`ALL /create` route:

1. No `req.query.lz` ⇒ `500 "Cannot parse JSON data, err 2"` (`server.js:104844`).
2. `lzData = JSON.parse(lzDecompress(req.query.lz))` inside try/catch
   (`server.js:104847-104849`). `lzDecompress` =
   `__webpack_require__(77).decompressFromEncodedURIComponent` (`server.js:104817`) —
   **lz-string, not base64** (see A.2).
3. Reject if `!lzData || !lzData.urls || !lzData.urls.length` ⇒
   `500 "Cannot parse JSON data, err 3"` (`server.js:104850-104851`).
4. **Key derivation:** `hashKey = sha256(req.query.lz).hex`
   (`server.js:104852`). The hash is over the **raw, still-compressed** `lz` query string
   (the exact bytes of the URL param), NOT the decompressed JSON and NOT a base64 form.
   Deterministic ⇒ identical stream URLs collapse to one store entry.
5. `storeDataToKey(lzData.urls, hashKey)` registers + emits (`server.js:104853`).
6. Build `opts` from the decompressed body (`server.js:104853-104857`):
   `fileMustInclude` (verbatim), `maxFiles` (if `>0`), `fileIdx` (if `>-1`).
   Result is `false` when empty.
7. **302 redirect** to
   `Location: /<archiveType>/stream?key=<hashKey>[&o=<encodeURIComponent(JSON.stringify(opts))>]`
   (`server.js:104858`). The `o` param is later read back as
   `opts = JSON.parse(req.query.o)` (`server.js:25653` pattern, used by `parseQuery`).

### Step 2 — GET /stream, gated by `waitForKey` (`server.js:104900-105009`)

`waitForKey(req)` (`server.js:104863-104870`) is the wait state:

```
key = parseQuery(req).query.key
if !key            -> reject(Error("No stream key provided"))
if store.get(key)!==null -> resolve() immediately
else               -> initEmitter.addListener(key, () => { remove; resolve() })
```

So a `/stream?key=K` that arrives **before** its `/create` (or a bare key with no
registration) parks until the matching `initEmitter.emit(K)` fires. A rejected wait ⇒
`500` empty body (`server.js:104902-104905`). In the normal core flow the 302 target
already carries a key whose store entry exists, so it resolves immediately; the wait
state only matters for out-of-order / racing clients.

**State machine (per key K):**

```
        POST /create or GET /create?lz=          GET /stream?key=K
UNKNOWN ───────────────────────────────► REGISTERED ──────────────► STREAMING
   │  (store.get(K)===null)                 (store.set + emit K)        │
   │                                                                    │
   └──── GET /stream?key=K arrives first ──► WAITING ──(emit K)────────►┘
              (waitForKey parks on initEmitter[K])
```

`fileVars[key]` (`server.js:104899`, `104908`, `104925`, `104933`) is a **per-router
memo cache** of the resolved inner-file descriptor (offset/size/filename/innerFile), so a
seek-heavy client re-opening ranges does not re-parse the zip central directory each time.

## A.2 The `?lz=` codec (lz-string, sha256 key)

- **Encoder (core):** `lz_str::compress_to_encoded_uri_component(&stream_data)`
  (`crates/core/src/types/resource/stream.rs:266, 299, 332, 365, 398, 432`). Dependency
  `lz-str = "0.2"` (`crates/core/Cargo.toml:94`).
- **Decoder (blob):** `decompressFromEncodedURIComponent` (`server.js:104817`). This is
  lz-string's URI-safe variant (6-bit alphabet
  `A-Za-z0-9+-`, `-`/`+` swapped for URL safety) — **it is not base64 and not gzip**.
- **What gets compressed:** `serde_json::to_string(&ArchiveStreamBody)`
  (`stream.rs:263, 296, 329, 362, 395`). `ArchiveStreamBody`
  (`crates/core/src/types/streaming_server/request.rs:14-19`) serializes as:
  ```json
  { "urls": [ ["https://host/a.zip"], ["https://host/a.z01", 12345] ],
    "fileIdx": 2, "fileMustInclude": ["\\.mkv$"] }
  ```
  `options` is `#[serde(flatten)]`ed to top level (`request.rs:17`), matching the blob's
  reads of `lzData.urls / lzData.fileIdx / lzData.fileMustInclude / lzData.maxFiles`
  (`server.js:104850-104856`). Each url is an `ArchiveUrl` serialized in **short array
  form** `[url]` or `[url, bytes]` via `ArchiveUrlShort`
  (`stream.rs:853-899`); `bytes` omitted when `None` (`stream.rs:858`). `fileIdx`/`urls`
  ordering must be preserved for the `orderRegex` volume-sort to be a no-op on single
  volumes.
- **Key:** `sha256_hex(lz_param_string)` (`server.js:104852`). In Rust: hash the exact
  percent-decoded? — NO: the blob hashes `req.query.lz` **as Express delivers it** (query
  parser already percent-decodes once). Diff-test to lock which side of decoding is hashed
  (see recipe A.6).

**Rust decode crate:** the **same `lz-str` crate** already vendored for encoding
(`crates/core/Cargo.toml:94`) exposes `lz_str::decompress_from_encoded_uri_component(&str)
-> Option<String>`. Use it; do not hand-roll and do not substitute a base64/gzip decoder.
Round-trip property test: `decompress(compress(x)) == x` for arbitrary UTF-8 `x`.

## A.3 Per-compression offset math (stored vs deflate)

The zip stream handler branches on `file.compressionMethod` (`server.js:104918`). The
`file` object is produced by `getZipStream` (module 546, impl `server.js:45691-45748`),
which opens the central directory via `unzipper.Open.url` (`server.js:45717`), selects one
entry (A.4), and attaches `file.inner = innerFiles[0]` — the underlying HTTP-ranged source
(`server.js:45731`). Entry fields come from the local file header parse
(`entryVars`, `server.js:45815-45840`): `flags, compressionMethod, compressedSize,
uncompressedSize, fileNameLength, extraFieldLength, offsetToLocalFileHeader` (zip64 escapes
`0xFFFFFFFF` are patched from the extra field, `server.js:45848-45856`).

### STORED (`compressionMethod === 0`) — true random access (`server.js:104918-104931`)

```
entryVars = await file.entryVars()            // re-reads the 30-byte local header + names
offset = file.offsetToLocalFileHeader
       + 30                                   // fixed local file header size
       + entryVars.fileNameLength
       + entryVars.extraFieldLength
       + (file.flags & 1 ? 12 : 0)            // 12-byte encryption header if bit0 set
size   = file.uncompressedSize || entryVars.uncompressedSize
```
(`server.js:104926-104927`). `offset` is the absolute byte position, inside the **outer
archive**, of the first payload byte of the (uncompressed==stored) inner file.

**Range mapping** (`server.js:104947-104988`):
- Parse first range only: `bytes=start-end` (`server.js:104952-104953`).
  - suffix form `bytes=-N` ⇒ `start = size-end; end = size-1` (`server.js:104954`).
  - open form `bytes=N-` ⇒ `end = size-1` (`server.js:104953-104954`).
- **Unsatisfiable ⇒ real `416`** with `Content-Range: bytes */<size>`
  (`server.js:104955-104957`). NOTE: this differs from the torrent engine (rider #3, which
  falls through to 200); archives DO emit 416.
- `206` headers include `Content-Range: bytes start-end/size`, `Accept-Ranges: bytes`,
  `Content-Length: end-start+1`, DLNA headers (`server.js:104958-104965`); `HEAD` returns
  after headers (`server.js:104966`).
- No-range ⇒ `200` with full `size` (`server.js:104967-104974`).
- **Translate inner range to outer archive bytes** (`server.js:104976-104978`):
  ```
  if (start || end) { rangeStart = start + offset; rangeEnd = end + offset }
  else              { rangeStart = offset;         rangeEnd = size + offset }
  ```
  then `file.inner.createReadStream({start: rangeStart, end: rangeEnd})` and pipe
  (`server.js:104981-104988`). i.e. Range on the *inner* file is a straight `+offset`
  shift into the *outer* HTTP source, because stored data is byte-identical.
  (Caveat to preserve: the no-range branch computes `rangeEnd = size + offset`, one byte
  past `offset+size-1`; reproduce exactly for a byte-diff match.)

### DEFLATE (`compressionMethod !== 0`) — no random access (`server.js:104989-105008`)

`fileVars[key]` is never populated (the offset block is stored-only), so control falls to
the else branch:
- Any range other than `bytes=0-` or `bytes=0-(contentLength-1)` ⇒ **`405`**
  (`server.js:104990-104991`). Seeking into a deflated inner file is unsupported.
- `HEAD` ⇒ `204` + `Content-Length`/`Content-Type` (`server.js:104992-104995`).
- Otherwise `200`, `Content-Length = file.uncompressedSize`, then `file.stream()` (an
  inflate stream, module `105161-105177`: `zlib.createInflateRaw()` when
  `compressionMethod` truthy) piped whole (`server.js:104996-105007`). `Content-Type` via
  `mime.lookup(file.path)` (`server.js:104993`, `105012-105015`).

**v1 rule:** implement stored-range exactly; for deflate, inflate-and-stream from byte 0
and reject non-`0-` ranges with 405. Do not attempt seekable deflate.

## A.4 Inner-file selection (shared with core semantics)

`getZipStream` picks the entry (`server.js:45699-45731`):
- If neither `fileMustInclude` nor `fileIdx` present, default
  `fileMustInclude = [/.mkv$|.mp4$|.avi$|.ts$/i]` (`server.js:45699-45701`).
- With `fileMustInclude`: first `directory.files` entry whose `path` matches any pattern,
  tested through `safeStatelessRegex(path, reg, 500)` — a **500 ms ReDoS-guarded** match
  (`server.js:45729-45730`); string patterns are `new RegExp(reg)`.
- Else with `fileIdx`: entry whose running index `countFiles === opts.fileIdx`
  (`server.js:45730`).
- `maxFiles` from the lz body is parsed into opts (`server.js:104856`) but is **not**
  consulted by the zip selector — treat as inert for zip. Multi-url = multi-volume
  (`server.js:45718-45721`).

## A.5 Per-format differences

- **rar** (`server.js:97477-97482`): `createKey.bind(null,"rar", null, null)` — **no
  orderRegex**, so no volume sort. Streaming delegates to `getRarStream` (module 514);
  range is handled by the rar lib's inner-file seek, not the zip offset math. Uses
  `rarInnerFile` (`server.js:97489`).
- **7zip** (`server.js:108519-108525`): `orderRegex=/\.7Z\.(\d\d?\d?\d?\d?)$/i`,
  `orderDefault=0`. Uses a 7z parser (module 561); decode is gated —
  `decompressionMethodId[0] !== 0 ⇒ "Decompression is not implemented"`
  (`server.js:109065-109066`), i.e. only **stored** 7z entries work; LZMA is unsupported
  even in the blob.
- **tar** (`server.js:109488-109494`): `orderRegex=/\.TAR\.(\d\d?\d?\d?\d?)$/i`,
  `orderDefault=0`. `getTarStream` (module 562).
- **tgz** (`server.js:110095-110101`): `orderRegex=/\.(\d\d?\d?\d?\d?)$/i`,
  `orderDefault=0`. `getTarStream` (module 563) with gzip layer.
- **nzb** (`server.js:96033-96045`): different shape — inline `createKeyHandler`,
  `waitForKeyData` keyed `init-${key}` (`server.js:96035-96041`), stream route
  `GET /stream/:key/:fileName` (`server.js:96043`). Fetches Usenet articles from configured
  servers; heavy external I/O.
- **ftp** (`server.js:110775-110788`): inline `createKeyHandler`; routes
  `POST /create/:createKey`, `ALL /create`, **`ALL /:fileName`**, and
  `GET /stream/:key/:fileName`. Range honored only if `supportsSeek`; otherwise only
  `bytes=0-` / full, else `405` (`server.js:110782-110783`). `206` with per-stream
  `size/mime/filepath/lastModified` (`server.js:110780-110789`).

## A.6 v1 recommendation

| Format | v1 | Rationale |
|---|---|---|
| **zip** | **YES** | Pure-Rust (`zip`/`async_zip` or hand-rolled central-dir parse + `+offset` range). Stored = trivial ranged proxy; deflate = `flate2` inflate stream. This is the only format with an auditable, dependency-light path and is the one the JS client exercises most. |
| rar | defer | Needs `unrar` (non-free) or an external lib; no memory-safe pure-Rust decoder. |
| 7zip | defer | Blob itself only supports **stored** 7z (`server.js:109066`); LZMA out. Low value. |
| tar | maybe | Pure-Rust (`tar` crate) is cheap; low demand. Add if a consumer needs it. |
| tgz | maybe | tar + `flate2`; same as tar but gunzip-first (no inner random access). |
| nzb | defer | Full Usenet client (NNTP, yEnc, multi-server) — out of proportion. |
| ftp | defer | FTP client + seek negotiation; niche. Gate behind a feature flag. |

Implement the **shared key handshake + `?lz=` codec + `/stream` state machine once**, then
plug zip as the only decoder in v1. Keep the store + `waitForKey` generic so tar/tgz can be
added without touching the protocol layer.

---

# PART B — SUPPORT ALGORITHMS (M3b)

## B.1 `/opensubHash` — OpenSubtitles movie hash (`server.js:46706-46720`)

Route handler `server.js:46706-46720` calls `subtitlesHash({url: req.query.videoUrl})`
(module 794, impl `server.js:70749-70821`); the hash math lives in the opensub client
(module 795, `server.js:70838-70879`).

### Algorithm (HTTP path, `server.js:70782-70817`)

1. `HEAD` the `videoUrl`; require `resp.ok`; `file_size = parseInt(content-length)`; NaN
   ⇒ error (`server.js:70784-70789`). Follow redirects → use `resp.url` as the media URL
   (`server.js:70788`).
2. First checksum part = `file_size.toString(16)` (hex, unpadded)
   (`server.js:70790`).
3. Two ranged GETs, each with header `enginefs-prio: 10` (`server.js:70799-70803`):
   - head: `bytes=0-65535`
   - tail: `bytes=(file_size-65536)-(file_size-1)` (`server.js:70791-70797`).
   Each response body **must be exactly 65536 bytes** else error
   (`server.js:70808`).
4. For each chunk: `checksumBuffer(Buffer.concat([data, buf_pad]), 16)` where `buf_pad`
   is 65536 zero bytes (`server.js:70754`, `70809`). The pad is a **deliberate quirk**:
   `checksumBuffer(buf, 16)` iterates `i < buf.length/16` (`server.js:70867-70870`), and
   each iteration reads an **8-byte** little-endian word via `read64LE`
   (`server.js:70864-70866`). With `buf.length = 131072`, that is `131072/16 = 8192`
   iterations × 8 bytes = the full 65536 real bytes. Without the pad, a bare 65536 buffer
   would only sum its first 32768 bytes. Reimplementation must sum **all 65536 bytes** as
   8192 uint64 LE words — do NOT copy the `/16` divisor literally; it is an artifact of the
   pad trick.
5. `read64LE` (`server.js:70864-70866`): take 8 bytes at `8*offset`, reverse them, i.e.
   interpret as **little-endian uint64**.
6. Combine with `sumHex64bits` (`server.js:70871-70875`): add two 16-hex numbers as
   64-bit, **mod 2^64** (keep low 16 hex via `substr(-16)`), carry handled in two 32-bit
   halves. Order: `sum(filesize, headChecksum, tailChecksum)` — commutative, so order is
   irrelevant to the result.
7. Final: `padLeft(chksum, "0", 16)` — **16-char lowercase hex, zero-padded**
   (`server.js:70758`, `70876-70878`).

### Reference formula (endianness-locked)

```
hash = ( file_size
       + Σ_{i=0..8191} u64_le(head[8i .. 8i+8])
       + Σ_{i=0..8191} u64_le(tail[8i .. 8i+8]) ) mod 2^64
output = lowercase_hex(hash) zero-padded to 16 chars
```
Endianness: **little-endian** per 8-byte word. This is the canonical OSDb hash; Rust:
`u64::from_le_bytes` over each 8-byte window, `wrapping_add`, `format!("{:016x}", h)`.

### Response envelope (`server.js:46712-46719`)

`200 application/json {"error": null, "result": {"hash": "<16hex>", "size": <file_size>}}`
(the client sets `res.size` at `server.js:70789`, `res.hash` at `70758`). On failure
`error` is `err.message` (`server.js:46711`), `code = 500` (`server.js:46710`).

Rust must issue: one `HEAD` (to get length + follow redirects) then two ranged `GET`s with
`enginefs-prio: 10`. When the videoUrl points back at this server's own torrent route, that
header sets piece priority (rider #3).

### Oracle-diff recipe

Serve a fixed local file (e.g. a 10 MB random blob) via a plain HTTP file server, then
`GET http://127.0.0.1:11470/opensubHash?videoUrl=<enc(url)>` against both the container and
Rust. Compare the `result.hash` (must be identical 16-hex) and `result.size`. Cross-check
against a third independent implementation (the published OSDb hash of the same bytes) to
catch a shared-bug false match. Edge cases to include: file exactly 128 KiB (head and tail
overlap), file just over 64 KiB, and a URL that 302-redirects (verify `resp.url` is used).

## B.2 `/subtitles.:ext` — SRT / WEBVTT re-serializer (`server.js:46721-46740`)

This is **not** a passthrough SRT→VTT text filter — it demuxes the source via
`subtitlesTracks({url: query.from})` (module 733) and re-emits cues. `:ext` selects format:
`isVtt = req.url.match("^/subtitles.vtt")` (`server.js:46722`).

Transform (`server.js:46728-46739`):
- If VTT: write header `"WEBVTT\n\n"` (`server.js:46728`). SRT: no header.
- Optional `?offset=<ms>`: shift every cue time by `offset` ms
  (`server.js:46722, 46731-46735`).
- Per track `i`, in order (`server.js:46736-46739`):
  ```
  <i>\n
  <format(start)> --> <format(end)>\n
  <text with &→&amp;>\n
  \n
  ```
- Timestamp `format` (`server.js:46729-46730`): VTT ⇒ `HH:mm:ss.SSS` (**dot**), SRT ⇒
  `HH:mm:ss,SSS` (**comma**). Both via `moment(d).utcOffset(0)`.
- Only text escape is `&` → `&amp;` (`server.js:46738`). No `<`/`>` escaping.
- Empty track list ⇒ `500` (`server.js:46727`); demux error ⇒ `500`
  (`server.js:46726`).

So the **only** VTT-vs-SRT differences are: the `WEBVTT\n\n` header and the millisecond
separator (`.` vs `,`). Cue numbering is 0-based (`i.toString()`).

**Client fallback (`packages/video/src/withHTMLSubtitles/withHTMLSubtitles.js:405-467`):**
`getSubtitlesData` fetches `track.url`; on any load/parse/convert error and `!isFallback`,
it retries with `track.fallbackUrl` (the **raw** subtitle URL) via
`loadSubtitles(selectedTrack, true)` (`withHTMLSubtitles.js:452-460`, `405-406`). So if the
Rust `/subtitles.vtt` endpoint 500s, the player silently falls back to the raw URL — the
endpoint is best-effort, not load-bearing, but a 500 that should have been a valid VTT
degrades UX.

### Oracle-diff recipe

Host a small multi-cue `.srt`. Request
`/subtitles.vtt?from=<enc(srt_url)>` and `/subtitles.srt?from=...` against container and
Rust; byte-compare bodies. Then request with `?offset=1500` and confirm every timestamp
shifted +1.5 s identically. Include a cue containing `&` to lock the `&amp;` escape and a
cue with `<i>` tags to confirm they are NOT escaped.

## B.3 `/tracks/:url` and `/subtitlesTracks` — pure-JS demux (`server.js:46644`, `46693`)

- `GET /tracks/:url` (`server.js:46644-46656`): `getTracksData(req.params.url,
  {maxBytesLimit: 26214400})` (module 812, 25 MiB cap), returns the track array as JSON;
  on error returns `200 []` (`server.js:46651-46655`). Enumerates audio/text tracks by
  demuxing the media container (MKV/EBML parser present at `server.js:28159`, `38179`).
- `GET /subtitlesTracks` (`server.js:46693-46705`): `subtitlesTracks({url:
  req.query.subsUrl})` (module 733), returns `{error, result}` JSON; error ⇒ `500`
  (`server.js:46697-46704`). This is the demux feeding B.2.

**BUG to fix (rider #6):** the *client* helper hardcodes the host:
`fetch('http://127.0.0.1:11470/tracks/'+encodeURIComponent(url))`
(`packages/video/src/tracksData.js:2`). This breaks whenever the streaming server runs on a
non-default host/port (remote server, custom port, HTTPS). The response classifies
`type === 'audio'` → `audio[]` and `type === 'text'` → `subs[]`
(`tracksData.js:5-6`). The Rust rewrite does not control this JS file, but the port
milestone must (a) keep `/tracks/:url` answering on the configured bind address and (b)
flag `tracksData.js:2` for a companion patch to use the configured
`streaming_server_url` instead of the literal `http://127.0.0.1:11470`. The server-side
route itself has no hardcoded host — the defect is purely client-side, but a Rust server on
a different port will never be reached until the client is fixed.

### Oracle-diff recipe

Host an MKV with 2 audio + 2 subtitle tracks. `GET /tracks/<enc(url)>` against container and
Rust; compare the JSON arrays (track `type`, `id`, language, codec fields) element-wise.
`GET /subtitlesTracks?subsUrl=<enc(url)>`; compare `result` cue arrays. Negative test: a
non-media URL must yield `200 []` from `/tracks` (not 500) to match `server.js:46651-46655`.
Also test a URL > 25 MiB to confirm the `maxBytesLimit` cap behavior matches.

## B.4 `/yt/:id` — YouTube redirect (`server.js:46681-46687`)

- `GET /yt/:id` (`server.js:46681-46687`): `getYt(id)` →
  `ytdl.getInfo("http://www.youtube.com/watch?v="+id, {downloadURL:true})`, then
  `ytdl.chooseFormat(inf.formats, {filter:"audioandvideo"})` (`server.js:46658-46667`).
  On success `301` with `Location: format.url` (a `googlevideo.com` URL); missing url ⇒
  `404`; error ⇒ `403` (`server.js:46683-46686`).
- `GET /yt/:id.json` (`server.js:46672-46680`): same resolve, returns the format object as
  JSON; `403 {err}` on error, `404` if no url, else `200 <format>`
  (`server.js:46674-46679`).

**Expectation:** this WILL break as YouTube changes its player/signature scheme; `ytdl`
churns constantly. A best-effort Rust version needs: a maintained extractor crate
(e.g. `rustube`, or shelling out to `yt-dlp` if a subprocess is acceptable), producing an
`audio+video` progressive format URL; emit `301 Location: <googlevideo url>` for `/yt/:id`
and the format JSON for `/yt/:id.json`; on any failure emit `403` (route) / `403 {err}`
(json) to match the blob's error codes. Treat as **non-critical / feature-flagged** — do
not block M3b on it, and document that parity is time-bounded by upstream YouTube changes.

### Oracle-diff recipe

Because upstream is non-deterministic, diff on **shape**, not bytes: `GET /yt/<id>` against
container and Rust; assert both return `301` with a `Location` host of `*.googlevideo.com`
(the signed URL itself will differ and expire — do not byte-compare). For `/yt/<id>.json`
assert both `200` with a `.url` field present, and matching error codes (`403`/`404`) for an
invalid id. Pin the test to tolerate upstream outage (skip, don't fail, on network error).

---

## Cross-cutting test harness note

Every recipe above is a "same request → container vs Rust, diff the response" case
(README "One reference oracle"). Archives additionally need a **2-step** oracle script:
POST/GET `/create` to obtain the redirect, then follow the `Location` to `/stream` with a
`Range` header, diffing the 206 body bytes and all headers (`Content-Range`,
`Content-Length`, DLNA fields). For the `?lz=` path, generate the URL with the same
`lz-str` encoder core uses so both servers receive byte-identical `lz` params (the sha256
key must match).
