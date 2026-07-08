<!--
id: streaming-server-rust-spec-02
tags: [streaming-server, rust, wire-format, m1-stream, m2-stats, librqbit]
related_files:
  - .research/server.js
  - crates/core/src/types/resource/stream.rs
  - crates/core/src/types/streaming_server/statistics.rs
  - crates/core/src/types/streaming_server/request.rs
  - crates/core/src/models/streaming_server.rs
  - packages/video/src/withStreamingServer/fetchVideoParams.js
  - packages/video/src/HTMLVideo/getContentType.js
status: spec
last_sync: 2026-07-08
-->

# Wire-format spec: media stream + `stats.json` family (M1 + M2)

Byte-exact contract for the two milestones that touch the torrent engine. Every claim is
cited to `.research/server.js` (`file:line`, the proprietary blob) or to an **observed
container response** captured from the running oracle at `http://127.0.0.1:11470` on
2026-07-08. Do not contradict `README.md` / `decomposition.md`; this fills in their detail.

The whole engine router is one `connect`/`Router` instance built at `server.js:18194`,
mounted after `bodyParser.json({limit:"3mb"})` and `bodyParser.urlencoded` (`18278-18282`).
`sendCORSHeaders` runs first for every route (`router.use(sendCORSHeaders)`, `18342`).

---

## Cross-cutting: CORS + method dispatch (applies to all routes below)

`sendCORSHeaders` (`server.js:18284-18289`):

- `OPTIONS` **with** an `Origin` header → **short-circuits**: sets
  `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST, GET, OPTIONS`,
  `Access-Control-Allow-Headers: <request's access-control-request-headers, else "Range">`,
  `Access-Control-Max-Age: 1728000`, then `res.end()` (empty 200). Never reaches the route.
- Any request **with** an `Origin` header (non-OPTIONS) → adds `Access-Control-Allow-Origin: *`
  and continues.
- No `Origin` header → no CORS headers added.

**HEAD dispatch:** routes are registered with `router.get(...)` only, but the `Router`
(webpack module 122) dispatches `HEAD` to the `GET` handler. `handleTorrent` proves this by
branching on `"HEAD" === req.method` explicitly (`server.js:18269-18270`). `getContentType.js:10`
(video) issues `fetch(url, {method:'HEAD'})` and reads `content-type` from the 200 — **HEAD
must return the full header set with an empty body.**

Observed on every JSON route (container, 2026-07-08): responses are
`Transfer-Encoding: chunked`, `Content-Type: application/json`, `Connection: keep-alive`,
`Keep-Alive: timeout=5`, plus a `Date`. There is **no `Content-Length`** on JSON responses
(`res.end(JSON.stringify(...))` streams chunked). Reproduce chunked framing, or at least do
not emit a `Content-Length` that a byte-diff of headers would flag. `Server`/`X-Powered-By`
are **absent** — do not add them.

---

# SPEC #1 — `GET|HEAD /:infoHash/:idx` (+ `/:infoHash/:idx/*`)

Registered at `server.js:18420`:
```
router.get("/:infoHash/:idx",   sendDLNAHeaders, handleTorrent)
router.get("/:infoHash/:idx/*", sendDLNAHeaders, handleTorrent)
```
`sendDLNAHeaders` runs as middleware **before** `handleTorrent`, so its two headers are set
even on the 500 error path (see below). The `/*` trailing-segment variant exists so a client
may append a human-readable filename after the index (e.g. `/HASH/3/Movie.mkv`); the extra
segments are ignored by the parser (only `parts[0]`/`parts[1]` are read — `18214-18218`).

Handler body: `handleTorrent` at `server.js:18203-18271`.

## 1.1 Path parse + the `:idx` UNION type

`handleTorrent` re-parses `req.url` (`18204`), then:
```
parts = pathname.split("/").filter(x=>x)      // 18214
parts[0] must match IH_REGEX = /([0-9A-Fa-f]){40}/g   // 18111, 18217
infoHash = parts[0].toLowerCase()             // 18218
i = Number(parts[1] || -1)                    // 18218  <-- default -1 when idx absent
```
Resolution algorithm (`server.js:18227-18244`), in order:

1. **`fileMustInclude` selector wins first.** If `?f=` query params were supplied, the engine
   scans `engine.files` and sets `i` to the index of the first file whose name matches any
   selector via `safeStatelessRegex(file.name, reg, 500)` (500 ms ReDoS budget) (`18229-18233`).
   Selectors of the literal form `/pattern/flags` are compiled to `RegExp`; everything else is
   wrapped as `new RegExp(string)` (`18204-18212`). If this sets `i`, steps 2–3 are skipped.
2. **Filename form** (`isNaN(i)` — i.e. `parts[1]` is not numeric and selector didn't match):
   `name = decodeURIComponent(parts[1])`; find the file where `name === file.name`
   (exact, case-sensitive, full-name equality — **not** a path/substring match) (`18235-18238`).
   No match ⇒ `Error("Cannot parse path: … invalid file index or file name")` ⇒ **500**.
3. **`-1` form** (GuessFileIdx): `i === -1` ⇒ `i = GuessFileIdx(engineStats.files, {})`
   (`18239-18242`).
4. **Integer form:** `i` is used directly. If `!engine.files[i]` ⇒
   `Error("Torrent does not contain file with index "+i)` ⇒ **500** (`18243`).

> A route typed `i32` will 404/500 the filename form. The Rust param must be
> `enum FileIdx { Index(i32 /* -1 sentinel */), Name(String) }`, resolved after the engine's
> file list is known. Match `parts[1]` numeric-first (`Number()` semantics: `"3"`→3, `"03"`→3,
> `"3x"`→NaN→filename branch, `""`/absent→-1).

### GuessFileIdx (module 664, `server.js:62038-62058`) — exact algorithm

`GuessFileIdx(files, seriesInfo)`:
```
MEDIA_RE = /.mkv$|.avi$|.mp4$|.wmv$|.vp8$|.mov$|.mpg$|.ts$|.m3u8$|.webm$|.flac$|.mp3$|.wav$|.wma$|.aac$|.ogg$/i
if !Array.isArray(files) || !seriesInfo: return -1
mediaFiles = files.filter(f => f.path.match(MEDIA_RE))    // matches file.PATH, not name
if mediaFiles.length === 0: return -1
if !(seriesInfo.season && seriesInfo.episode): seriesInfo = false
pool = seriesInfo ? mediaFiles filtered by parseVideoName(season==,episode∈) : (if empty, mediaFiles)
selected = pool.reduce((best,f) => (!best || f.length > best.length) ? f : best, null)  // LARGEST by byte length
return files.indexOf(selected)
```
For the `/:idx = -1` route it is called with `{}` (`18241`), so `seriesInfo` collapses to
`false` and the result is **the largest file among video/audio media extensions** — *not* the
largest file overall, and *not* a plain `files[]` max. If no file matches `MEDIA_RE`, returns
`-1`, and then `!engine.files[-1]` ⇒ 500. Replicate the extension filter and the `.path`
(not `.name`) field, and note the regex dots are unescaped (`.mkv` matches `Xmkv` too — a
harmless over-match to preserve for parity).

`video`'s client-side mirror (`fetchVideoParams.js:91-99`) uses a *different, smaller* video
extension set and falls back to largest-of-all; that is the client's own guess for filename
display and does **not** drive server file selection — do not converge them.

## 1.2 Engine creation query params

Before resolving the file, `handleTorrent` may create/augment the engine:

- `?tr=<tracker>` (repeatable) → `opts.peerSearch = {min, max, sources:[trackers]}` using
  `EngineFS.getDefaults(infoHash)` mins (`18219-18225`; defaults min 40 / max 200,
  `18182-18184`). Core sends these as `tr` (`stream.rs:556-559`).
- `?f=<selector>` (repeatable) → `fileMustInclude` (see §1.1 step 1). Core sends as `f`
  (`stream.rs:562-568`).

Core builds the URL at `stream.rs:537-571`: `path.extend([hex(info_hash), file_idx or "-1"])`
— it always sends a numeric index or the `-1` sentinel (never the filename form), then appends
`tr`/`f` query pairs. So the filename branch is exercised only by other callers / manual use,
but must still be implemented (contract completeness).

## 1.3 `?external` — 307 redirect (checked BEFORE any streaming)

`server.js:18252-18253`: if `?external` is truthy, respond **307** with
```
Location: /<infoHash>/<encodeURIComponent(handle.name)><"?download=1" if ?download else "">
```
and empty body. Note: it redirects to the **filename** form (encoded real file name), and
propagates `?download` but nothing else (drops `?subtitles`, `?external`). This runs after the
engine/file is resolved (so a bad idx still 500s first).

## 1.4 Range handling (`server.js:18259-18270`) — byte-level

```
range = req.headers.range
if range && range.endsWith("-"):
    if !EngineFS.getDefaults(infoHash).circularBuffer: prewarmStream(infoHash, fileIndex)  // 18260
range = range && rangeParser(handle.length, range)[0]   // 18261 — FIRST range only
```
`rangeParser` = the `range-parser` package, inlined at `server.js:18536-18560`, called
**without** `{combine}`:

- No `=` in header → returns `-2`.
- Each comma-part parsed; `end` clamped to `size-1` (`18545`); parts with `start>end`,
  `start<0`, or `NaN` are dropped.
- Zero valid parts → returns `-1`.
- Otherwise returns the **array of all ranges** (unsorted, uncombined).

`handleTorrent` takes `[0]`. Consequences to reproduce exactly:

| Request header (file size = N) | Parsed | Status | Content-Length | Content-Range |
|---|---|---|---|---|
| *(none)* | — | **200** | `N` | *(none)* |
| `bytes=0-99` | {0,99} | 206 | 100 | `bytes 0-99/N` |
| `bytes=100-` | {100,N-1} | 206 | N-100 | `bytes 100-(N-1)/N` |
| `bytes=-500` (suffix) | {N-500,N-1} | 206 | 500 | `bytes (N-500)-(N-1)/N` |
| `bytes=0-99,200-299` (multi) | **first only** {0,99} | 206 | 100 | `bytes 0-99/N` |
| `bytes=99999999-` (past EOF) | `-1` → `(-1)[0]`=undef | **200** | N | *(none)* |
| `bytes=abc` / malformed | `-2` → `(-2)[0]`=undef | **200** | N | *(none)* |

**There is NO 416.** An unsatisfiable or malformed range silently degrades to a **200 full
body** with the full `Content-Length`. Multi-range requests are answered with a single part
(the first) — **no `multipart/byteranges`, ever.**

**Prewarm:** any open-ended `bytes=N-` (header string `endsWith("-")`, tested on the raw
header before parsing) triggers `prewarmStream` = `engine.files[idx].select()` (`18195-18198`),
**unless** the engine's `circularBuffer` default is set. Suffix ranges (`bytes=-500`) do NOT
end with `-` and do not prewarm. In librqbit terms: an open-ended range should mark the file
as fully selected/prioritized-to-end (not just the requested window).

## 1.5 `enginefs-prio` request header → per-request piece priority

`server.js:18266`: `opts.priority = parseInt(req.headers["enginefs-prio"]) || 1`. Any present
`enginefs-prio` header sets a per-read stream priority passed into
`handle.createReadStream({...range, priority})` (`18269`). Non-numeric or `0` → falls back to
`1` (`|| 1`). Map to librqbit `FileStream` read priority for that request only.

## 1.6 Fixed response headers on the stream (200 and 206)

Set unconditionally for the streaming responses (`server.js:18261-18264`, `18267-18269`):

| Header | Value | Source |
|---|---|---|
| `Accept-Ranges` | `bytes` | `18261` |
| `Content-Type` | `mime.lookup(handle.name)` | `18262` |
| `Cache-Control` | `max-age=0, no-cache` | `18262` |
| `Content-Length` | `range.end-range.start+1` (206) or `handle.length` (200) | `18267`,`18269` |
| `Content-Range` | `bytes <start>-<end>/<handle.length>` (206 only) | `18268` |
| `Content-Disposition` | `attachment; filename="<handle.name>";` — **only if `?download`** (note trailing `;`) | `18263` |
| `CaptionInfo.sec` | `<value of ?subtitles>` — **only if `?subtitles`** (DLNA subtitle URL) | `18264` |
| `transferMode.dlna.org` | `Streaming` | `sendDLNAHeaders`, `18291` |
| `contentFeatures.dlna.org` | see quirk below | `sendDLNAHeaders`, `18291` |

**`Content-Type` = `mime.lookup(name)`** (mime module 611, `Mime.prototype.lookup` at `8618`):
returns `types[ext]` else `default_type` = `mime.lookup("bin")` = `application/octet-stream`
(`8626`). Path is lowercased, ext = chars after the last `.`. So `.mp4`→`video/mp4`,
`.mkv`→`video/x-matroska`, `.avi`→`video/x-msvideo`, unknown/no-ext→`application/octet-stream`.
No `charset` is appended. This header is a **MUST-match** byte-for-byte.

**`contentFeatures.dlna.org` quirk — reproduce verbatim (has an embedded space):**
```
DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=017000 00000000000000000000000000
```
Verified at the byte level (`server.js:18291`; UTF-8 byte 0x20 sits at offset 32, right after
`FLAGS=017000`). Every *other* DLNA string in the blob is the canonical spaceless
`...FLAGS=01700000000000000000000000000000` (`95681`, `104965`, `109552`, …). The stream
route's is the anomalous one with a space. For byte-exact oracle parity, emit it **with the
space**. (Clients ignore the trailing flag bytes, so it is a cosmetic blob bug — but a diff of
raw response headers will flag any deviation.)

## 1.7 Socket timeout + stream lifecycle

- `req.connection.setTimeout(864e5)` = **24 h** idle socket timeout on the streaming
  connection (`18258`). Do not let the Rust server's default read/idle timeout kill a paused
  playback; set the equivalent 86 400 000 ms.
- `res.on("finish"|"close")` emits `stream-close`; `stream-open` emitted at start (`18254-18257`).
  These drive engine keep-alive/GC internally; not observable on the wire but affects when an
  idle engine is torn down (see the `get_torrent_statistics` note re: engine recreation,
  `streaming_server.rs:703-705`).

## 1.8 Error path

Any resolution error → `console.error(err); res.statusCode = 500; res.end()` (`18251`) — an
empty-body 500 with the two DLNA headers already set (middleware ran) and CORS `*` if an
`Origin` was present. No JSON error body. (500, not 404, for "no such file/index".)

---

# SPEC #2 — the `stats.json` family

Three routes, all `res.writeHead(200, {"Content-Type":"application/json"})` then
`res.end(JSON.stringify(...))`, chunked, no `Content-Length` (`jsonHead` = `18200-18202`).
All three call `getStatistics(engine, idx?)` (`server.js:18294-18338`).

| Route | server.js | idx passed | Consumer | Body when engine absent |
|---|---|---|---|---|
| `/:infoHash/:idx/stats.json` | `18346-18347` | yes (`req.params.idx`) | **core** + video | `null` (observed) |
| `/:infoHash/stats.json` | `18344-18345` | no | **video only** | `null` (observed) |
| `/stats.json` (aggregate) | `18348-18355` | per-engine | none (debug) | `{}` (observed) |

Observed (container, 2026-07-08, no engines): `/HASH/stats.json` → `null`,
`/HASH/IDX/stats.json` → `null`, `/stats.json` → `{}`.

`getStatistics(e)` returns `null` immediately if the engine is absent (`18295`). The aggregate
route iterates `engines{}` and emits `{ "<infoHash>": <getStatistics(e)>, ... }` (`18350-18354`).

## 2.1 `?sys=1` — DROP (host-info leak)

`/stats.json` checks `req.url.match("sys=1")` — a **substring match on the whole URL string**
(`18351`), not a parsed query flag, so `?anything=sys=1` or any URL containing `sys=1` triggers
it. When triggered it adds `stats.sys = { loadavg: os.loadavg(), cpus: os.cpus() }`.

Observed leak (container): full `os.cpus()` array — CPU model string
(`"Intel(R) Core(TM) i7-14700"`), per-core `times`, and `loadavg`. This exposes host hardware.
**The Rust server must not implement `?sys=1`** (README "Dropped deliberately"). The aggregate
route itself is consumer-less; implement it returning only the per-engine map, or drop it — but
never the `sys` branch.

## 2.2 EXACT field inventory of `getStatistics(e, idx)` (`server.js:18294-18337`)

Base object `s` (always present when engine exists), followed by the per-file `util._extend`
block appended **only when `idx` is a valid number and `e.torrent.files[idx]` exists**
(`18331-18337`).

Legend for **Rust source**: **rqbit** = derivable from librqbit; **STUB** = no librqbit
analogue, emit a fixed placeholder; **local** = computed by our shim (bencode/config/piece
bookkeeping).

| JSON field | server.js | Type | JS source | Rust source / stub value |
|---|---|---|---|---|
| `infoHash` | 18297 | string (lowercase hex) | `e.infoHash` | rqbit (info hash) |
| `name` | 18298 | string \| null | `e.torrent.name` | rqbit (torrent name); `null` pre-metadata |
| `peers` | 18299 | number | `swarm.wires.length` | rqbit (live peer count) |
| `unchoked` | 18300-18302 | number | wires not `peerChoking` | **STUB `0`** (rqbit exposes no choke state) |
| `queued` | 18303 | number | `swarm.queued` | **STUB `0`** |
| `unique` | 18304 | number | `Object.keys(swarm._peers).length` | **STUB `0`** (or reuse `peers`) |
| `connectionTries` | 18305 | number | `swarm.tries` | **STUB `0`** |
| `swarmPaused` | 18306 | bool | `swarm.paused` | rqbit (paused state) |
| `swarmConnections` | 18307 | number | `swarm.connections.length` | rqbit (connection count) |
| `swarmSize` | 18308 | number | `swarm.size` | rqbit (est. swarm size) or **STUB `0`** |
| `selections` | 18309 | array | `e.selection` | local (our selection list) or **STUB `[]`** |
| `wires` | 18310-18321 | array\|null | per-peer objects; **null when idx passed** | **STUB `[]`** (`null` when per-file idx) |
| `files` | 18322 | array\|undef | `e.torrent.files` = `{name,path,length,offset}[]` | rqbit + bencode (see §2.3) |
| `downloaded` | 18323 | number | `swarm.downloaded` | rqbit (bytes down) |
| `uploaded` | 18324 | number | `swarm.uploaded` | rqbit (bytes up) |
| `downloadSpeed` | 18325 | number (B/s) | `swarm.downloadSpeed()` | rqbit |
| `uploadSpeed` | 18326 | number (B/s) | **`swarm.downloadSpeed()`** (blob bug — reads DOWN) | rqbit (up speed); note blob returns down |
| `sources` | 18327 | array\|undef | `swarm.peerSearch && .stats()` | **STUB `[]`** (see §2.3 caveat) |
| `peerSearchRunning` | 18328 | bool\|undef | `swarm.peerSearch ? .isRunning() : undef` | **STUB `false`** (see §2.3 caveat) |
| `opts` | 18329 | object | `e.options` | local (echo the create options; see §2.3) |
| **per-file (idx only):** | | | | |
| `streamLen` | 18333 | number | `file.length` | rqbit/bencode (selected file length) |
| `streamName` | 18333 | string | `file.name` | rqbit/bencode (selected file name) |
| `streamProgress` | 18334-18336 | number 0..1 | availablePieces/filePieces over the file's piece span via `e.bitfield` | local (piece-availability math over librqbit's have-bitfield) |

`wires[]` element shape (when present, torrent-level only) (`18313-18320`):
`{ requests:number, address:string, amInterested:bool, isSeeder:bool, downSpeed:number, upSpeed:number }`.
Since we stub `wires: []`, this shape is documentary.

`uploadSpeed` reads `swarm.downloadSpeed()` in the blob (`18326`) — a genuine bug: the oracle
reports upload speed equal to download speed. Our shim should report the **true** upload speed
(rqbit) — this is one of the fields *allowed to differ* from the oracle (see §2.4).

### `streamProgress` math (`18334-18336`) — reproduce exactly

```
startPiece = floor(file.offset / pieceLength)
endPiece   = floor((file.offset + file.length - 1) / pieceLength)
availablePieces = count of i in [startPiece..endPiece] where bitfield.get(i)
filePieces = ceil(file.length / pieceLength)
streamProgress = availablePieces / filePieces
```
Note `availablePieces` counts inclusive `[startPiece,endPiece]` (which is
`endPiece-startPiece+1` pieces when full) but the denominator `filePieces` is
`ceil(file.length/pieceLength)`; for files not aligned to piece boundaries these differ by up
to 1, so `streamProgress` can exceed 1.0 slightly. Preserve this formula (do not "correct" the
off-by-one) for parity of the fully-downloaded value.

## 2.3 The Rust deserialize contract — the fields you MUST emit

Core deserializes the **per-file** `/:infoHash/:idx/stats.json` into `Option<Statistics>`
(`streaming_server.rs:697`) via `TorrentStatisticsRequest` which hits
`/{infoHash}/{fileIdx}/stats.json` with `file_idx: u16` (`request.rs:44-49, 136-161`) — core
**never** sends `-1` here (it uses the resolved index), so `streamLen/streamName/streamProgress`
are always present in the response core reads.

`Statistics` (`crates/core/src/types/streaming_server/statistics.rs:77-102`) has **all fields
non-`Option`** (`serde` default = required). Missing any ⇒ deserialize fails ⇒ `Option` resolves
to `None` ⇒ stats never populate. The required camelCase keys are:
```
name, infoHash, files[], sources[], opts, downloadSpeed, uploadSpeed, downloaded, uploaded,
unchoked, peers, queued, unique, connectionTries, peerSearchRunning, streamLen, streamName,
streamProgress, swarmConnections, swarmPaused, swarmSize
```
`files[]` element = `{ name:String, path:String, length:u64, offset:u64 }` (`statistics.rs:8-13`)
— all four required, so bencode `offset`/`path` must be computed even though librqbit may not
surface `offset` directly (sum of preceding file lengths).
`sources[]` element = `{ lastStarted:String, numFound:u64, numFoundUniq:u64, numRequests:u64,
url:Url }` (`statistics.rs:67-75`).
`opts` = full `Options` struct (`statistics.rs:52-65`): `{ connections?, dht:bool,
growler:{flood:u64,pulse?}, handshakeTimeout?, path:String, peerSearch:{max,min,sources[]},
swarmCap:{maxSpeed?,minPeers?}, timeout?, tracker:bool, virtual:bool }` — `dht`, `growler.flood`,
`path`, `peerSearch`, `swarmCap`, `tracker`, `virtual` are required.

**Rider (critical):** the JS blob *omits* `sources` and `peerSearchRunning` from the JSON when
`swarm.peerSearch` is falsy (`JSON.stringify` drops `undefined`). Core's own `Statistics`
requires them. Therefore the Rust server **must always emit** `sources: []` and
`peerSearchRunning: false` (and a well-formed `opts`) even with no peer search running — do not
faithfully reproduce the blob's *omission*, or core's deserialize breaks. This is a case where
correct-for-core diverges from byte-identical-to-oracle (see §2.4). `Statistics` also has **no**
field for `queued`, `selections`, `wires`, `swarmSize`? — it *does* include `queued`, `unique`,
`swarmConnections`, `swarmSize`; it does **not** deserialize `selections` or `wires` (serde
ignores unknown keys), so those stubs are cosmetic-only.

## 2.4 Oracle-diff test recipe

Goal: for a real torrent, prove the Rust server's `stats.json` and stream headers match the
container on the **load-bearing** fields, and only differ on documented stubs.

Setup (both servers): create the same engine, then hit identical paths. Example uses the
Sintel demo infohash `08ada5a7a6183aae1e09d831df6748d566095a10` (public, well-seeded).

```powershell
$C = "http://127.0.0.1:11470"      # container oracle
$R = "http://127.0.0.1:11471"      # rust server under test
$IH = "08ada5a7a6183aae1e09d831df6748d566095a10"

# 1. create engine on both (magnet form, guessFileIdx)
$body = '{"guessFileIdx":true}'
Invoke-RestMethod "$C/$IH/create" -Method Post -ContentType application/json -Body $body
Invoke-RestMethod "$R/$IH/create" -Method Post -ContentType application/json -Body $body

# 2. torrent-level stats (video path) — compare file list + names
$c = Invoke-RestMethod "$C/$IH/stats.json"
$r = Invoke-RestMethod "$R/$IH/stats.json"
# 3. per-file stats (core path) — pick guessedFileIdx / largest video
$idx = 0
$cf = Invoke-RestMethod "$C/$IH/$idx/stats.json"
$rf = Invoke-RestMethod "$R/$IH/$idx/stats.json"

# 4. stream headers, no body: HEAD
$hc = Invoke-WebRequest "$C/$IH/$idx" -Method Head -UseBasicParsing
$hr = Invoke-WebRequest "$R/$IH/$idx" -Method Head -UseBasicParsing
# 5. range: first-range-only + no-416 checks
Invoke-WebRequest "$C/$IH/$idx" -Headers @{Range="bytes=0-99,200-299"} -Method Head -UseBasicParsing   # expect 206, CL=100, no multipart
Invoke-WebRequest "$C/$IH/$idx" -Headers @{Range="bytes=999999999999-"} -Method Head -UseBasicParsing   # expect 200 full, no Content-Range
```

**MUST match byte-for-byte** (fail the diff on any difference):

- `stats.json` keys and values: `infoHash`, `name`, `files[]` (`name`,`path`,`length`,`offset`
  each), `streamName`, `streamLen`, `swarmPaused`, and — after full download — `streamProgress`.
  `guessedFileIdx` (from `/create`, see spec-01) must select the same file → same `streamName`.
- Stream **headers**: `Accept-Ranges: bytes`; `Cache-Control: max-age=0, no-cache`;
  `Content-Type` (from `mime.lookup`); `Content-Range`/`Content-Length` per the §1.4 table;
  status codes (200 vs 206 vs 307 vs 500); `Content-Disposition` under `?download`;
  `CaptionInfo.sec` under `?subtitles`; `transferMode.dlna.org: Streaming`;
  `contentFeatures.dlna.org` **including the embedded space** (§1.6); the `?external` 307
  `Location`.
- Absence of a `416` for unsatisfiable ranges; absence of `multipart/byteranges`.
- Absence of `Server`/`X-Powered-By`/`Content-Length`-on-JSON.

**ALLOWED to differ** (stubs / bug-fixes — assert *presence & type*, not value equality):

- `unchoked`, `queued`, `unique`, `connectionTries` → oracle has real values; Rust emits `0`.
- `wires[]`, `sources[]`, `selections` → oracle populated; Rust emits `[]`.
- `peerSearchRunning` → oracle may reflect real search; Rust emits `false` when idle.
- `peers`, `downloaded`, `uploaded`, `downloadSpeed`, `uploadSpeed`, `swarmConnections`,
  `swarmSize` → live counters; they drift second-to-second. Assert numeric type / monotonic
  sanity, not equality. **`uploadSpeed`**: oracle reports the download speed (blob bug, §2.2);
  Rust reports true upload — expected to differ.
- `opts` → echo of engine options; structural match required (core must deserialize it) but
  individual tunables (`connections`, timeouts) may differ from the container's config.
- `Date` header, chunked-transfer framing details.
- `?sys=1` block → **must be absent** on Rust; on the oracle it leaks host info (do not diff,
  do not reproduce).

Recommended diff harness: parse both JSON bodies, delete the allowed-to-differ keys from both,
then assert deep-equality on the remainder; separately assert the allowed keys exist with the
right JSON type. For headers, lowercase-normalize names, drop `Date`, and assert the MUST list.

---

## Appendix: minimal source map

| Concern | Location |
|---|---|
| `handleTorrent` | `.research/server.js:18203-18271` |
| `sendDLNAHeaders` | `.research/server.js:18290-18292` |
| `sendCORSHeaders` | `.research/server.js:18284-18289` |
| `getStatistics` | `.research/server.js:18294-18338` |
| stats routes | `.research/server.js:18344-18355` |
| stream routes reg. | `.research/server.js:18420` |
| `GuessFileIdx` (mod 664) | `.research/server.js:62038-62058` |
| `rangeParser` (mod 176) | `.research/server.js:18536-18560` |
| `mime.lookup` (mod 611) | `.research/server.js:8618-8626` |
| core URL builder | `crates/core/src/types/resource/stream.rs:527-581` |
| core stats request | `crates/core/src/types/streaming_server/request.rs:44-49,136-161` |
| core `Statistics` type | `crates/core/src/types/streaming_server/statistics.rs:6-102` |
| core stats fetch | `crates/core/src/models/streaming_server.rs:690-714` |
| video filename resolver | `packages/video/src/withStreamingServer/fetchVideoParams.js:43-109` |
| video HEAD content-type | `packages/video/src/HTMLVideo/getContentType.js:10-17` |
