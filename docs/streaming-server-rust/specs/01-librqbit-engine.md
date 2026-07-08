<!--
id: streaming-server-rust-m1-librqbit-engine
tags: [streaming-server, rust, librqbit, torrent, M1, spec]
related_files:
  - crates/core/src/types/streaming_server/request.rs
  - crates/core/src/types/streaming_server/response.rs
  - crates/core/src/types/streaming_server/statistics.rs
  - packages/video/src/withStreamingServer/createTorrent.js
  - .research/server.js
parent: docs/streaming-server-rust/README.md
status: spec
last_sync: 2026-07-08
-->

# M1 — Torrent engine (librqbit) implementation spec

Byte-exact spec for milestone **M1** of `crates/streaming-server`. Fills in the M1 row
of the contract table in `../README.md` and the `[M1: torrent engine — librqbit]` branch of
`../decomposition.md`. This document is self-contained: an engineer implements M1 from it
without re-reading the 6.6 MB blob.

Everything the JS blob does that M1 must reproduce is reverse-engineered from
`.research/server.js` and cited `file:line`. Every librqbit claim is cited to
docs.rs / GitHub. **Pin `librqbit = "=8.1.1"`** (stable 8.x; do NOT use `9.0.0-rc*`).

M1 covers exactly four route families:

| Method | Path | Consumer |
|---|---|---|
| POST/ALL | `/create` | core (`CreateTorrentBlobRequest`) |
| POST/ALL | `/:infoHash/create` | core + video (`createTorrent.js`) |
| GET/HEAD | `/:infoHash/:idx` and `/:infoHash/:idx/*` | core + video |
| GET | `/:infoHash/remove`, `/removeAll` | lifecycle |

Stats endpoints (`/:infoHash/stats.json`, `/:infoHash/:idx/stats.json`, `/stats.json`) are
**M2** and are only referenced here where the `create` responses reuse the same
`getStatistics` object shape (`server.js:18294-18338`).

---

## 1. Dependencies & session setup

### 1.1 Crate additions

New workspace member `crates/streaming-server` (does not exist yet — confirmed by glob). Add
to root `Cargo.toml` `members` (currently `crates/core`, `core-web`, `derive`,
`watched-bitfield` — `Cargo.toml:3-8`). The crate is `edition = "2021"`.

```toml
[dependencies]
# Torrent engine. Pin exact; avoid 9.0.0-rc. default-features off drops the built-in
# http-api-client and native TLS; `rust-tls` uses rustls+ring (no OpenSSL/schannel).
# librqbit enables its OWN tokio features internally (macros, rt-multi-thread, fs, io-util).
librqbit    = { version = "=8.1.1", default-features = false, features = ["rust-tls"] }
axum        = "0.7"             # router; matches the "expose an axum::Router" goal (README:22)
tokio       = { version = "1", features = ["rt-multi-thread", "macros", "net", "fs", "io-util", "signal"] }
tower       = "0.4"
tower-http  = { version = "0.5", features = ["cors"] }   # CORS parity (server.js:18284-18288)
http        = "1"
serde       = { version = "1", features = ["derive"] }
serde_json  = "1"
hex         = "0.4"             # /create blob is hex (request.rs:64)
mime_guess  = "2"               # mime.lookup parity (server.js:18262)
tokio-util  = { version = "0.7", features = ["io"] }     # ReaderStream: FileStream -> axum body
anyhow      = "1"
tracing     = "0.1"
regex       = "1"               # fileMustInclude compilation (linear-time; see §4 ReDoS note)
```

> **MSRV.** The workspace pins Rust **1.95** (`rust-toolchain.toml:2`); `crates/core` sets
> `rust-version = "1.77"`. librqbit 8.1.1 declares **no `rust-version`** (no formal MSRV); a
> source comment pins its intent below Rust 1.81 (it can't bump `url` until 1.81), so it is
> comfortably under 1.95 — **no concern**. The new crate does
> **not** target wasm (unlike `core`); it is native-only. Do **not** add it to any
> wasm build graph. `librqbit` pulls a large native tree (tokio, reqwest/rustls, DHT, bencode);
> keep it isolated behind the `crates/streaming-server` boundary so `core`'s
> `wasm32-unknown-unknown` target (`rust-toolchain.toml:3`) stays clean.

### 1.2 Session bootstrap

The JS engine defaults (`EngineFS.getDefaults`, `server.js:18179-18188`) that M1 must match:

```js
{ peerSearch: { min: 40, max: 200, sources: ["dht:"+ih] }, dht: false, tracker: false }
```

Two load-bearing facts:

1. **Per-torrent cache dir** = `path.join(os.tmpdir(), infoHash)` (`server.js:18189-18190`,
   used at `18120`). `appPath`/`cacheRoot` come from `APP_PATH` env or `tmpdir/<pkgname>`
   (`server.js:35942-35943`, `12638`). M1: one librqbit `Session` rooted at a configurable
   cache dir (default OS temp); librqbit lays out per-torrent subfolders itself.
2. **Leech-only, DHT/trackers OFF by default.** `dht:false, tracker:false`
   (`server.js:18186-18187`). Peers come only from `peerSearch.sources` (DHT is
   force-added as `"dht:"+ih` when peerSearch is supplied — see §2.3). **No inbound
   listen port** — this is a client that dials out; it never accepts incoming peers.

**librqbit mapping — one `Arc<Session>` for the whole server:**

```rust
use librqbit::{Session, SessionOptions};
use std::path::PathBuf;

let opts = SessionOptions {
    disable_dht: false,               // DHT ON — sole peer source when trackers are off
    listen_port_range: None,          // <-- NO inbound TCP listener bound => leech-only
    enable_upnp_port_forwarding: false,
    persistence: None,                // do not persist added-torrent state to disk
    ..Default::default()
};
// `default_output_folder` is the cache root; librqbit creates per-torrent subfolders.
let session = Session::new_with_opts(PathBuf::from(config.cache_dir), opts).await?;
```

Key facts (verified against the `v8.1.1` source, `crates/librqbit/src/session.rs`):
- **Leech-only = `listen_port_range: None`** (the `Default`). The TCP listener is created
  *only* inside `if let Some(port_range) = opts.listen_port_range`, so `None` binds no inbound
  socket. There is **no `ListenerOptions`/`disable_listen`** in 8.1.1 — that API is 9.x, which
  we are avoiding. Pair with `enable_upnp_port_forwarding: false`.
- **DHT**: `disable_dht: bool` (+ `disable_dht_persistence`, `dht_config`). Keep DHT **on** —
  with `tracker:false` it is the only way to find peers for a magnet.
- **Cache dir**: the constructor's `default_output_folder` arg. There is no distinct "cache"
  vs "output" dir; storage is mmap'd files under that folder. Per-torrent override:
  `AddTorrentOptions::output_folder` / `sub_folder`.
- **Trackers**: session-wide `SessionOptions::trackers: HashSet<Url>`; per-torrent disable via
  `AddTorrentOptions::disable_trackers`.
- **PEX**: **no librqbit equivalent** — `SessionOptions` exposes no PEX toggle in 8.1.1.
  Acceptable: peer discovery already relies on DHT + `peerSearch` trackers, matching the
  blob's `dht:false,tracker:false`+explicit-sources posture.

---

## 2. Endpoints

All routes are one axum `Router` returned by `pub async fn router(Config) -> axum::Router`
(`decomposition.md:18`). CORS: mirror `sendCORSHeaders` (`server.js:18284-18288`) — allow
`*`, methods `POST, GET, OPTIONS`, allow-headers echo request or `Range`, max-age `1728000`;
`OPTIONS` short-circuits 200/empty. Body limit `3mb` (`server.js:18278-18279`).

InfoHash validation: JS `IH_REGEX = /([0-9A-Fa-f]){40}/g` — **40 hex chars only**
(`server.js:18111`, applied `18217`). A 64-char (BitTorrent v2 / SHA-256) infohash hits
`return cb(new Error("Not implemented yet"))` (`server.js:18247`) — **M1 replicates this: 64-char
infohash ⇒ error, not supported.** Lowercase the infohash before use (`18218`, `18357`).

### 2.1 `POST /create` (raw .torrent blob)

Handler: `server.js:18383-18412`. Body is JSON `{ from?, blob? }`.

- **`blob` (string, hex)** → `Buffer.from(blob,"hex")` → `parseTorrentFile` → `createEngine`
  (`18385`, `18397`, `18401`). This is the **only** branch M1 implements. Core always sends
  this: `CreateTorrentBlobBody { blob: hex::encode(torrent) }` (`request.rs:56-71`).
- **`from` (string) — TWO BRANCHES TO DROP** (`server.js:18386-18391`). See §5 (DO NOT PORT).

**Request parse:** JSON `{ "blob": "<hex>" }`. Reject if `blob` absent or non-string
(JS falls to the `from` path and `onErr()`s — `18386`). Decode hex → bytes.

**Engine call:** add the raw `.torrent` bytes to the session (§3 row 2c). Derive the
infohash from the parsed metainfo; lowercase it.

**Response:** `200`, `Content-Type: application/json`, body = the full `getStatistics(engine)`
object (`server.js:18411`, shape in §2.5). On any failure: `500`, empty body
(`onErr`, `18408`). No 4xx is ever produced by this route.

### 2.2 `POST /:infoHash/create` (magnet / infohash + guess)

Handler: `router.all("/:infoHash/create", …)` (`server.js:18356-18382`). Method is `ALL`
(accept POST; GET/others also work in JS). Body JSON — the shape core/video send:

```jsonc
// createTorrent.js:23-53
{
  "torrent": { "infoHash": "<40hex>" },        // optional; ih also in the path
  "peerSearch": { "sources": ["dht:<ih>","tracker:<url>", …], "min": 40, "max": 200 },
  "guessFileIdx": {} | { "season": N, "episode": M } | false,
  "fileMustInclude": ["<string|/regex/flags>", …]   // selector; see below
}
```

Core's builder: `CreateMagnetBody { peerSearch }` (`request.rs:79-128`), where `peerSearch`
sources are normalized so each non-`dht:`/`tracker:` entry becomes `tracker:<url>`
(`request.rs:86-98`, mirroring `createTorrent.js:31-38`). `min:40, max:200` are fixed
(`request.rs:106`, `createTorrent.js:36-37`). `guessFileIdx` is `{}`/`{season,episode}` when
the caller wants a guess, or `false` to suppress it (`createTorrent.js:41-53`).

**Engine call:** `createEngine(ih, body, cb)` (`18358`). If no metainfo present it seeds a
magnet: `"magnet:?xt=urn:btih:"+infoHash` (`server.js:18122`). `peerSearch` supplies sources;
when the torrent has its own `announce` list those become `tracker:<src>` plus `dht:<ih>`,
otherwise `options.peerSearch.sources` is used verbatim (`server.js:18125-18129`).

**File-index resolution — runs after the engine is ready, mutating the stats object
(`server.js:18360-18380`):**

1. **`fileMustInclude` selector** (`18362-18378`). If present and non-empty:
   - Compile each element: a string of the form `/pat/flags` (matches
     `isRegex = /^\/(.*)\/(.*)$/`) is compiled to a `RegExp(pat, flags)`; a bare string is
     kept as-is and later wrapped `new RegExp(reg)` (`18364-18371`, `18374`).
   - Find the **first** file whose `file.name` matches **any** compiled pattern under the
     `safeStatelessRegex(name, reg, 500)` guard; set `engineStats.guessedFileIdx = idx`
     (`18372-18377`). First match wins and stops the scan.
   - `safeStatelessRegex` (`server.js:10602-10616`): runs `str.match(re)` inside a Node
     `vm` context with a **500 ms timeout**; on timeout/throw it logs "detected as evil …
     ignoring" and returns `null` (falsy) — i.e. a catastrophic-backtracking pattern is
     silently skipped. **Rust port:** the `regex` crate is linear-time and
     backtracking-free, so it is ReDoS-immune by construction — the 500 ms wall is
     unnecessary. But `regex` rejects some JS constructs (backreferences, lookaround). On
     `Regex::new` compile error, **skip that pattern** (matches JS "ignore evil regex"
     semantics). See §5 and §6.
2. **`guessFileIdx`** (`18379`): only if `body.guessFileIdx` is truthy AND `guessedFileIdx`
   was not already set by `fileMustInclude`: `engineStats.guessedFileIdx =
   GuessFileIdx(engineStats.files, body.guessFileIdx)`. When `body.guessFileIdx === false`
   (video sends this to suppress — `createTorrent.js:52`), no guess is added.

**`GuessFileIdx(files, seriesInfo)`** — full algorithm at `server.js:62040-62058`:

```
MEDIA_RE = /.mkv$|.avi$|.mp4$|.wmv$|.vp8$|.mov$|.mpg$|.ts$|.m3u8$|.webm$
            |.flac$|.mp3$|.wav$|.wma$|.aac$|.ogg$/i        (server.js:62039)
1. media = files where file.path matches MEDIA_RE.        (62042-62044)
2. if media empty  -> return -1.                          (62045)
3. if seriesInfo has BOTH season and episode:             (62046)
     episodeMatch = media where parseVideoName(path) has
       info.season === seriesInfo.season AND
       info.episode includes seriesInfo.episode.          (62047-62053)
   else episodeMatch = [].
4. pool = episodeMatch.length ? episodeMatch : media.
5. pick the LARGEST file in pool by .length (reduce).     (62054-62056)
6. return files.indexOf(selectedFile).                    (62057)
```

So "largest file" (README:89 / decomposition.md) is precisely **largest _media_ file**, and
for a series it is the **largest episode-matching media file**. Called with `{}` (empty
seriesInfo) at `18241`/`18379` ⇒ largest media file overall. `parseVideoName` lives at
webpack module 303 (`server.js:62039`); M1 needs only enough of it to extract `season` +
`episode[]` from a filename — port lazily, guessing degrades to "largest media file" if
parsing yields nothing.

**Response:** `200`, JSON = `getStatistics(engine)` **with `guessedFileIdx` injected** when a
guess/selector fired (`18381`, `18379`, `18374`). Consumer reads exactly `resp.guessedFileIdx`
(`createTorrent.js:68`) and nothing else from the body — but M2 stats consumers read the rest,
so emit the whole object (§2.5). Failure ⇒ `500` empty.

### 2.3 `GET`/`HEAD` `/:infoHash/:idx` (+ `/:infoHash/:idx/*`) — the stream

Handlers: `router.get("/:infoHash/:idx", sendDLNAHeaders, handleTorrent)` and the `/*`
variant (`server.js:18420`); `handleTorrent` at `18203-18272`. This is the headline route.

**`:idx` is a UNION TYPE**, resolved in `handleTorrent`'s inner function (`18213-18249`):

- `i = Number(parts[1] || -1)` (`18218`).
- **`fileMustInclude` via query `?f=`** (`18204-18212`, applied `18229-18233`): `u.query.f`
  (repeatable) compiled the same `/pat/flags`-or-string way, first file whose `name` matches
  under `safeStatelessRegex(…,500)` sets `i = idx`.
- **filename form** (`18234-18238`): if `i` is `NaN` (idx segment was a filename, not a
  number), `name = decodeURIComponent(parts[1])`; find file where `name === file.name`, set
  `i`. Still `NaN` ⇒ `cb(Error("… invalid file index or file name"))` ⇒ **500**.
- **`-1` ⇒ GuessFileIdx** (`18239-18242`): `i = GuessFileIdx(engineStats.files, {})` (largest
  media file). **A route typed `i32` will 404/500 the filename and `?f=` forms — parse `:idx`
  as an opaque string** (README:89-91).
- Out-of-range: `if (!engine.files[i]) cb(Error("… does not contain file with index "+i))`
  ⇒ **500** (`18243`).
- **Query `?tr=`** (repeatable, `18204`, `18219-18225`) overrides `peerSearch.sources` for
  this engine at creation time (min/max from defaults).

**Response headers — set on EVERY stream response (`18252-18270`):**

- `sendDLNAHeaders` middleware first (`18290-18293`): `transferMode.dlna.org: Streaming` and
  `contentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000 000000000000000000000000`.
- `Accept-Ranges: bytes` (`18261`).
- `Content-Type: mime.lookup(handle.name)` (`18262`) — use `mime_guess::from_path`.
- `Cache-Control: max-age=0, no-cache` (`18262`).
- `?download` ⇒ `Content-Disposition: attachment; filename="<name>";` (`18263`).
- `?subtitles=<v>` ⇒ `CaptionInfo.sec: <v>` (`18264`).
- **`?external` ⇒ 307 redirect** BEFORE opening any stream (`18252-18253`): `Location:
  /<infoHash>/<urlencoded name>` (+ `?download=1` if `download` present), empty body.

**Range contract (byte-level, `18259-18270`) — reproduce exactly:**

- `range = req.headers.range`; if it `endsWith("-")` (open-ended `bytes=N-`) and the engine's
  `circularBuffer` is off, **prewarm**: `prewarmStream` selects the file
  (`18260`, `18195-18199`).
- `range = rangeParser(handle.length, range)[0]` — **only the FIRST range** is honored; no
  multipart (`18261`).
- `rangeParser` returns a negative sentinel for malformed (-1) / unsatisfiable (-2) ranges, so
  `[0]` is `undefined` ⇒ falsy ⇒ **falls through to the 200 full-body branch. There is NO 416**
  (`18267` guard; README:92-93).
- **`enginefs-prio` request header** (`18266`): `opts.priority = parseInt(header) || 1`, passed
  into `createReadStream(opts)` — per-request piece priority.
- Satisfiable range ⇒ `206`; `Content-Length = end-start+1`; `Content-Range: bytes
  start-end/length` (`18267-18268`).
- No range ⇒ `200`; `Content-Length = handle.length` (`18269`).
- **`HEAD`** ⇒ headers only, `res.end()` (no body) in both branches (`18269-18270`).
- Body otherwise streamed from `handle.createReadStream(range±opts)` via `pump` — **this is
  the librqbit `FileStream`** (§4).
- Side effects (M2-adjacent, keep the hooks): emit `stream-open`/`stream-close`
  (`18254-18257`); `req.connection.setTimeout(864e5)` = 24 h idle timeout (`18258`).

**Engine call:** get-or-create the engine for `infoHash` (idempotent — a bare
`GET /:ih/:idx` with no prior `create` auto-creates a magnet engine, `18227`+`18122`), resolve
the file index (union above), open a librqbit `FileStream` for that file (§4), seek/limit per
the range, stream to the axum body.

### 2.4 `GET /:infoHash/remove` and `GET /removeAll`

- `router.get("/:infoHash/remove", …)` (`server.js:18413-18416`): `removeEngine(infoHash)` →
  `200` `{}` JSON.
- `router.get("/removeAll", …)` (`18417-18419`): loop all engines → `removeEngine(ih)` → `200`
  `{}` JSON.
- `removeEngine` (`18170-18175`): `engines[ih].destroy(cb)` then deletes the in-memory map
  entry. This is a **stop/forget**, not an explicit user "delete downloaded files" — see §3 row
  6 for the librqbit `delete_files` decision (open question in §6).

### 2.5 The `getStatistics` response object (shared by 2.1 / 2.2)

`getStatistics(engine, idx?)` — `server.js:18294-18338`. Both `create` routes return this
object (plus injected `guessedFileIdx` on `/:ih/create`). Field-by-field, cross-checked
against `crates/core/src/types/streaming_server/statistics.rs`:

| JSON field | `server.js` | core type (`statistics.rs`) | M1 value |
|---|---|---|---|
| `infoHash` | 18297 | `Statistics.info_hash` (:81) | real |
| `name` | 18298 | `.name` (:80) | metainfo name |
| `peers` | 18299 | `.peers` (:89) | live peer count |
| `unchoked` | 18300-18302 | `.unchoked` (:88) | stub `0` (M1) → real M2 |
| `queued` | 18303 | `.queued` (:91) | stub `0` |
| `unique` | 18304 | `.unique` (:92) | stub `0` |
| `connectionTries` | 18305 | `.connection_tries` (:93) | stub `0` |
| `swarmPaused` | 18306 | `.swarm_paused` (:100) | `false` |
| `swarmConnections` | 18307 | `.swarm_connections` (:99) | stub `0` |
| `swarmSize` | 18308 | `.swarm_size` (:102) | stub `0` |
| `selections` | 18309 | — (not typed by core) | `[]` |
| `wires` | 18310-18321 | (only per-torrent, `idx` undef) | `[]` |
| `files` | 18322 | `.files: Vec<File>` (:82) | **real** — `{name,path,length,offset}` (`statistics.rs:6-13`) |
| `downloaded` | 18323 | `.downloaded` (:86) | real |
| `uploaded` | 18324 | `.uploaded` (:87) | real (0 leech-only) |
| `downloadSpeed` | 18325 | `.download_speed` (:84) | real |
| `uploadSpeed` | 18326 | `.upload_speed` (:85) | real — **NB blob bug: JS sets this to `downloadSpeed()` too (`18326`)**; core just deserializes an f64, so emit real upload speed |
| `sources` | 18327 | `.sources: Vec<Source>` (:83) | `[]` (M1) |
| `peerSearchRunning` | 18328 | `.peer_search_running` (:94) | `false`/real |
| `opts` | 18329 | `.opts: Options` (:84) | echo the create opts (`statistics.rs:52-65`) |

When `idx` is a valid number, `getStatistics` merges per-file fields (`18331-18337`):
`streamLen = file.length`, `streamName = file.name`, `streamProgress = availablePieces /
ceil(file.length/pieceLength)` computed over the file's piece span (`18334-18336`). These map
to `Statistics.stream_len/stream_name/stream_progress` (`statistics.rs:95-98`). **M1 must emit
`files` and (for `/:ih/create`) `guessedFileIdx` for real**; the swarm/peer counters may be
stubbed `0`/`[]`/`false` and made real in **M2** (see decomposition.md M2). Field **names and
types must match exactly** or core's serde deserialize diverges.

> `Options` (the `opts` echo) fields core expects: `connections, dht, growler{flood,pulse},
> handshakeTimeout, path, peerSearch{max,min,sources}, swarmCap{maxSpeed,minPeers}, timeout,
> tracker, virtual` (`statistics.rs:52-65`). Populate from the create request + defaults
> (`dht:false, tracker:false, peerSearch{min:40,max:200}` — `server.js:18179-18188`).

---

## 3. librqbit capability map

All verified against the `v8.1.1` git tag and docs.rs/librqbit/8.1.1.

| # | Capability M1 needs | librqbit API (8.1.1) | Status |
|---|---|---|---|
| 1 | Session + cache dir + DHT/trackers + disable listen | `Session::new_with_opts(PathBuf, SessionOptions)`; `listen_port_range:None`, `disable_dht`, `trackers` | ✅ direct |
| 1b | PEX toggle | — | ❌ no equivalent — rely on DHT+trackers (acceptable) |
| 2a | Add from magnet URI | `Session::add_torrent(AddTorrent::from_url("magnet:…"), opts)` | ✅ direct |
| 2b | Add from bare 40-hex infohash | `AddTorrent::from_url("<40hex>")` — `Magnet::parse` special-cases `len==40` | ✅ direct (no `magnet:` wrap needed) |
| 2c | Add from raw `.torrent` bytes | `AddTorrent::from_bytes(Bytes)` | ✅ direct |
| 3 | Single-file selection | add-time `AddTorrentOptions{only_files:Vec<usize>, only_files_regex:String}`; runtime `Session::update_only_files(&handle, &HashSet<usize>)` | ✅ direct |
| 4 | Streaming read — AsyncRead+AsyncSeek, parks on piece, seek re-prioritizes | `Arc::clone(&handle).stream(file_id) -> FileStream` | ✅ direct (see §4) |
| 5 | Per-torrent + per-file stats | `ManagedTorrent::stats() -> TorrentStats { file_progress:Vec<u64>, progress_bytes, total_bytes, uploaded_bytes, live:Option<LiveStats>, state }` | ✅ direct |
| 6 | pause / unpause / remove / delete-files | `Session::pause/unpause(&handle)`; `Session::delete(TorrentIdOrHash, delete_files:bool)` | ✅ direct |

**Return-value plumbing.** `add_torrent` returns `AddTorrentResponse::{Added(id,Arc<ManagedTorrent>)
| AlreadyManaged(id,Arc<ManagedTorrent>) | ListOnly(_)}` — `Added` and `AlreadyManaged` both
yield the handle (idempotent get-or-create, exactly what §2.3 needs). `stream()` **consumes an
`Arc`** (`stream(self: Arc<Self>, file_id)`), so always `Arc::clone(&handle).stream(i)` and keep
`handle` for stats/lifecycle. `pause`/`unpause`/`update_only_files`/`delete` all live on
**`Session`**, taking `&Arc<ManagedTorrent>` or a `TorrentIdOrHash` (from `handle.id()` /
`handle.info_hash()`), **not** on `ManagedTorrent`.

**Stats field mapping to the wire object (§2.5):**

| Wire field (`getStatistics`) | librqbit source |
|---|---|
| `downloaded` | `TorrentStats.progress_bytes` |
| `uploaded` | `TorrentStats.uploaded_bytes` |
| `downloadSpeed` | `TorrentStats.live.download_speed` (`Speed`) |
| `uploadSpeed` | `TorrentStats.live.upload_speed` |
| `peers` | `TorrentStats.live.snapshot.peer_stats` (`AggregatePeerStats`) |
| `streamProgress` (per-file) | `TorrentStats.file_progress[idx]` ÷ file length (`with_metadata`) |
| `files[]` `{name,path,length,offset}` | torrent metadata via `ManagedTorrent::with_metadata(|m| m.file_infos…)` |
| `swarmPaused` | `TorrentStats.state == Paused` / `handle.is_paused()` |

`TorrentStatsState = {Initializing|Live|Paused|Error}` (serde `"initializing"|"live"|"paused"|"error"`).
`LiveStats.snapshot: StatsSnapshot { downloaded_and_checked_bytes, fetched_bytes, uploaded_bytes,
downloaded_and_checked_pieces, total_piece_download_ms, peer_stats }`. `live` is `Some` only while
state is `Live`. Source: `crates/librqbit/src/torrent_state/stats.rs`,
`.../live/stats/snapshot.rs`.

---

## 4. The streaming read (headline requirement)

**librqbit delivers this natively — no hand-rolling.** Verified against
`crates/librqbit/src/torrent_state/streaming.rs` at tag `v8.1.1`.

```rust
impl ManagedTorrent {
    pub fn stream(self: Arc<Self>, file_id: usize) -> anyhow::Result<FileStream>;
}
// FileStream is re-exported as librqbit::FileStream.
impl tokio::io::AsyncRead for FileStream {}   // CONFIRMED
impl tokio::io::AsyncSeek for FileStream {}   // CONFIRMED
impl FileStream { pub fn position(&self) -> u64; pub fn len(&self) -> u64; }
```

**Read parks until the piece is verified.** `poll_read` computes the current piece from the
read position, then checks the chunk tracker's `get_have_pieces()` bitfield. If the covering
piece is absent it registers the task waker and returns `Poll::Pending` — the read literally
parks. Crucially `get_have_pieces()` only sets a bit **after** the piece is hash-verified, so a
read never yields unverified bytes. When a piece completes, the download loop calls
`wake_streams_on_piece_completed(piece_id)`, waking exactly the streams whose `current_piece ==
piece_id`; the read then does a blocking `pread_exact` (on a blocking thread) and advances.

**Seek re-prioritizes piece download — the load-bearing behavior (README:135-137).**
`AsyncSeek::start_seek` validates the target and calls `set_position`, updating both the
`FileStream.position` and the **shared** `StreamState.position` in the session's
`TorrentStreams` map. The piece picker reads that shared position: each active stream
contributes a look-ahead window `start = file_abs_offset + position`,
`end = start + PER_STREAM_BUF_DEFAULT` where **`PER_STREAM_BUF_DEFAULT = 32 MiB`**.
`TorrentStreams::iter_next_pieces` interleaves every stream's window and the live downloader
requests those pieces first. So a `seek()` immediately relocates the 32 MiB high-priority
window to the new offset — **piece priority follows the read head automatically; there is no
deadline/priority call to make.** Seeking into an un-downloaded region also triggers
`maybe_reconnect_needed_peers_for_file` → `reconnect_all_not_needed_peers()`. `Drop for
FileStream` removes the `StreamState`, so a closed/aborted request stops prioritizing its
pieces (map this to axum request-cancellation).

This satisfies the two headline requirements exactly: reads **park until verify**, and seeks
**re-prioritize**. The only piece M1 adds on top is mapping the blob's `enginefs-prio` header
and open-ended prewarm (§2.3) — see §6 risks 2-3.

```rust
use std::{sync::Arc, io::SeekFrom};
use tokio::io::{AsyncSeekExt};
use tokio_util::io::ReaderStream;

let mut fs = Arc::clone(&handle).stream(file_index)?;   // FileStream, keep `handle`
if let Some(r) = first_range {                          // §2.3: first range only
    fs.seek(SeekFrom::Start(r.start)).await?;           // re-targets the 32 MiB window
}
// length-limit to r.end-r.start+1 (tokio::io::AsyncReadExt::take), then:
let body = axum::body::Body::from_stream(ReaderStream::new(fs.take(len)));
```

Full request wire-up: resolve file index (§2.3 union) → `Arc::clone(&handle).stream(idx)` →
`AsyncSeek` to `range.start` → length-limit to `range.end-start+1` (`AsyncReadExt::take`) →
`tokio_util::io::ReaderStream` → `axum::body::Body::from_stream`. No-range: stream `0..len`.
`HEAD`: never open the stream (headers only). librqbit has **no per-request priority/deadline
API** — the `enginefs-prio` header (`server.js:18266`) and open-ended-range prewarm (`18260`)
have no direct knob; treat them as documented no-ops or, if fidelity matters, use
`Session::update_only_files` to bias what downloads (§6 risk 3/10).

---

## 5. DO NOT PORT (security)

These exist in the blob and must be **deliberately absent** from M1.

1. **`POST /create` `from` = local file read** (`server.js:18391`):
   `fs.readFile(req.body.from, onBlob)` — an unauthenticated client body names an arbitrary
   local path and the server reads it as a torrent. **Arbitrary local file read.** Drop the
   entire `from` branch; accept `blob` only.
2. **`POST /create` `from` = server-side HTTP fetch** (`server.js:18387-18390`):
   `from.indexOf("http")===0 ? fetch(from).then(res=>res.buffer())` — the server fetches an
   attacker-controlled URL. **Classic SSRF** (reach internal metadata endpoints, internal
   hosts, port-scan). Drop it. (README:79-80, decomposition.md:35.)
   → Net rule for `/create`: **`blob`-only**. Missing/non-string `blob` ⇒ `500` (parity with
   JS `onErr`, `18386`/`18408`). Never read files, never make outbound fetches from this route.
3. **64-char infohash "Not implemented"** (`server.js:18247`) — keep it unimplemented; do not
   opportunistically add BT-v2 support in M1.
4. **`safeStatelessRegex` ⇒ untrusted regex.** `fileMustInclude`/`?f=` compile
   **client-supplied** regex (`18205-18212`, `18364-18371`). JS sandboxes with a 500 ms `vm`
   timeout (`10602-10616`). The Rust `regex` crate is linear-time / backtracking-free, so it is
   **not** vulnerable to ReDoS — no timeout needed. **But**: (a) reject/`skip` patterns that
   fail `Regex::new` (unsupported JS syntax; mirrors JS "ignore evil regex"); (b) do **not**
   fall back to any backtracking engine to gain JS-regex feature parity — that would
   reintroduce the ReDoS surface the guard existed to contain. Match `file.name` only, never a
   filesystem path outside the torrent.
5. **`sys=1` host-info leak** on `/stats.json` (`server.js:18351-18354`, returns `os.loadavg()`
   + `os.cpus()`) — M2 route, but noted here: never emit the `sys` block. (README:80.)

---

## 6. Open questions / risks for the implementer

1. **Listen port — LOW RISK, resolved.** `listen_port_range: None` binds no inbound TCP
   listener in 8.1.1 (verified: listener is created only under `if let Some(port_range)`).
   Residual: librqbit still speaks DHT over UDP (outbound) — that is expected and required for
   peer discovery, not an inbound accept surface. No uTP listener in this version. Add a
   regression test asserting no inbound TCP socket is bound.
2. **Seek re-prioritization — LOW RISK, resolved.** Verified: `FileStream` reads park on
   `Poll::Pending` until the piece is hash-verified, and `AsyncSeek` moves the shared 32 MiB
   (`PER_STREAM_BUF_DEFAULT`) high-priority window (streaming.rs). This is the headline feature
   working as required — **do not** hand-roll piece priority. Residual only: confirm behavior
   when a client issues many rapid small seeks (scrubbing) — the window churn is librqbit's to
   manage; oracle-diff seek-heavy playback against the container.
3. **`enginefs-prio` mapping.** `opts.priority = parseInt(header) || 1` (`18266`). librqbit's
   priority model may not be a per-request integer; map it to the nearest deadline/priority
   primitive or ignore with a documented no-op. Non-fatal (custom header, rarely set).
4. **`delete_files` on `/remove`.** JS `engine.destroy()` (`18171`) stops + forgets; whether it
   unlinks cached pieces depends on the store. Choose the librqbit remove variant:
   remove-but-keep-cache vs. delete-files. Default recommendation: **keep files** (a re-add
   should resume), matching typical `destroy` semantics; make it a config flag. Confirm against
   the container oracle.
5. **`GuessFileIdx` parity depends on `parseVideoName`.** Series episode matching
   (`server.js:62047-62053`) needs a filename parser (webpack module 303). If the Rust port of
   `parseVideoName` is weaker, series guessing silently degrades to "largest media file". Video
   passes `{season,episode}` (`createTorrent.js:43-49`); a wrong guess ⇒ wrong episode plays.
   Oracle-diff `guessedFileIdx` on real multi-episode packs.
6. **`ALL` verb on create routes.** JS registers both `create` routes with `router.all`
   (`18356`, `18383`) — GET works too. Match with axum `.on(MethodFilter::all-ish)` or at least
   GET+POST, or a client that GETs `/create` will 405.
7. **Idempotent auto-create on stream.** `GET /:ih/:idx` with no prior `create` must
   auto-create a magnet engine (`18227`+`18122`). Ensure get-or-create is race-safe under
   concurrent range requests for the same infohash (players open several).
8. **`uploadSpeed` blob bug.** JS reports `downloadSpeed()` for both speeds (`18326`); we emit
   the real value. Harmless divergence, but oracle-diff will show it — document as an
   intentional fix, not a regression.
9. **librqbit feature surface / binary size.** Use `default-features = false, features =
   ["rust-tls"]` (§1.1): drops the built-in `http-api-client`, `http-api` (axum server) and
   `webui`, and swaps native TLS for rustls+ring — you still get `Session`, streaming, stats,
   DHT, storage. The heavy optional pieces (`http-api`, `webui`, `postgres`) stay off. Aligns
   with the release profile `opt-level='s', lto=true` (`Cargo.toml:10-12`). Residual: `rust-tls`
   pulls `ring` (C/asm build) — fine on the container's build image; verify it cross-compiles if
   any non-x86_64 target is added later.
10. **`only_files_regex` vs manual selection.** For M1, do **not** wire `fileMustInclude` into
    librqbit's `only_files_regex` — the blob computes a *single* `guessedFileIdx` and streams
    that one file on demand via `/:ih/:idx`, independent of what the engine downloads. Resolve
    the index in the handler (§2.2/§2.3) and open a `FileStream` for it; let librqbit's stream
    windowing drive what actually downloads. `only_files`/`update_only_files` is a later
    optimization (restrict download to the selected file) — not required for contract parity.
