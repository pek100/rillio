<!--
id: streaming-server-rust
tags: [streaming-server, rust, librqbit, migration, critical]
related_files:
  - crates/core/src/models/streaming_server.rs
  - crates/core/src/types/streaming_server/
  - crates/core/src/types/resource/stream.rs
  - packages/video/src/withStreamingServer/
  - docker/streaming-server/
checklist: checklists/streaming-server-rust.md
status: planning
last_sync: 2026-07-08
-->

# Replacing `server.js` with a Rust streaming server

## Goal

Replace the proprietary 6.3 MB `server.js` blob (`docker/streaming-server`, fetched
from `dl.strem.io`) with an auditable, memory-safe Rust crate built on
[`librqbit`](https://github.com/ikatson/rqbit). The crate is **embeddable** — it
exposes an `axum` router a native host can mount in-process — with a thin binary for
standalone dev/testing.

## Why (the real threat model)

- The torrent **parser** ingests hostile bencode from arbitrary peers. Today that is
  closed-source JS we cannot audit. Rewriting it in Rust with `librqbit` is the actual
  security win — it eliminates the unauditable hostile-input surface.
- `ffmpeg` (the **decoder/transcoder**) is memory-unsafe C either way. Replacing the
  blob does **not** change that; it must be sandboxed regardless of language.
- Downloaded payloads are inert data. Never the threat.

## Scope decision (locked)

- **Full contract** — every route a consumer (`crates/core`, `packages/video`) calls
  is reproduced. Confirmed by the discovery workflow: no consumer fetch lacks a route.
- **Crate, embeddable** — `crates/streaming-server`, library-first.
- **One reference oracle**: the running container (`docker/streaming-server`) answers on
  `:11470`. Every milestone is verified by sending identical requests to both the
  container and the Rust server and **diffing the response** (JSON or bytes). This turns
  "did we reproduce the contract" from judgment into a test. It exists only because the
  container was built first.

## The contract (verified, with file:line)

Base URL = `profile.settings.streaming_server_url` (default `http://127.0.0.1:11470`).
All routes live on one Express router (`server.js:46838`). **called-by** reconciles the
three independent enumerations (core / video / blob-routes).

| Path | Method | called-by | ffmpeg | librqbit | Milestone |
|---|---|---|---|---|---|
| `/settings` | GET/POST | core | no | – | M0 |
| `/network-info` | GET | core | no | – | M0 |
| `/device-info` | GET | core | **yes** (stubbed) | – | M0 stub / M6 real |
| `/casting/`, `/casting/:dev/player` | GET/POST | core | no | – | M0 (empty list) |
| `/get-https` | GET | core | no | – | M0 |
| `/heartbeat`, `/`, `/favicon.ico` | GET | browser | no | – | M0 |
| `/create` | POST | core | no | ✅ | M1 |
| `/:infoHash/create` | POST | core+video | no | ✅ | M1 |
| `/:infoHash/:idx` (+`/*`) | GET/HEAD | core+video | no | ✅ | M1 |
| `/:infoHash/remove`, `/removeAll` | GET | – | no | ✅ | M1 |
| `/:infoHash/:idx/stats.json` | GET | core+video | no | ✅≈ | M2 |
| `/:infoHash/stats.json` | GET | **video only** | no | ✅≈ | M2 |
| `/stats.json` | GET | – | no | ✅≈ | M2 |
| `/proxy/:opts/:path` | ALL | core+video | no | – | **M3a** |
| `/opensubHash` | GET | video | no | – | M3b |
| `/subtitles.:ext` | GET | video | no | – | M3b |
| `/tracks/:url`, `/subtitlesTracks` | GET | video (TV) | no | – | M3b |
| `/yt/:id`, `/yt/:id.json` | GET | core | no | – | M3b |
| `/local-addon/manifest.json`, `/local-addon/:resource/:type/:id/:extra?` | GET | **core** | no | – | **M4** |
| `/{rar,zip,7zip,tar,tgz}/create/:key` + `/stream` | POST/GET | core | no | – | M5 |
| `/ftp/*`, `/nzb/*` | GET/POST | core | no | – | M5 (opt) |
| `/hlsv2/*` | GET | video | **yes** | – | **M6 (sidecar)** |

**Dropped deliberately** (no consumer + security): legacy HLS v1 family, `/probe`,
`/hwaccel-profiler`, `/stats.json?sys=1` (host info leak), `/create`'s `from` branches
(both `fs.readFile` local-read AND `http` server-side fetch — SSRF), `file://`/`url` HLS
sources.

## Critical correctness riders (from adversarial review — do not lose these)

1. **`/proxy` is a subsystem, not a header shim.** Follows ≤5 redirects; for
   `.m3u8`/`mpegurl` responses it strips `content-length`, forces chunked, and
   **rewrites every absolute URL in the playlist back through the proxy** with a
   recomputed options blob (`server.js:71867-71880`). `convertStream.js:53` routes
   *every* non-torrent direct-URL stream through it. It is on the critical path, not a
   tail feature — hence its own milestone (M3a) and a re-baselined estimate.
2. **`:idx` is a union type**, not an integer: numeric index, `-1` ⇒ GuessFileIdx
   (largest file), OR a URL-encoded filename matched against `engine.files`
   (`server.js:18235-18238`). A route typed `i32` will 404 the filename form.
3. **Range contract, byte-level** (`server.js:18258-18270`): only the *first* range is
   honored (no multipart); an unsatisfiable range falls through to `200` (there is **no
   416**); open-ended `bytes=N-` triggers prewarm; a custom `enginefs-prio` request
   header sets per-request piece priority; fixed headers `Accept-Ranges: bytes`,
   `Cache-Control: max-age=0, no-cache`; `?external` ⇒ 307, `?download` ⇒
   Content-Disposition, `?subtitles` ⇒ DLNA CaptionInfo; `sendDLNAHeaders` on every
   stream response; HEAD must work.
4. **`POST /:infoHash/create` has a `fileMustInclude` selector** ((string|regex)[], with
   a 500 ms ReDoS guard) that changes which file `guessedFileIdx` resolves to
   (`server.js:18362-18378`). Port it or file selection diverges from the JS client.
5. **Archives are a stateful 2-step protocol**, not a `GET`: `POST /create/:key` +
   `ALL /create` to register, then `GET /stream/:key/:fileName` with per-compression
   offset math and a `waitForKey` wait state (`server.js:104897-104936`). The `?lz=`
   param is lz-string `compressToEncodedURIComponent`, sha256-keyed — **not base64**.
6. **`/tracks` hardcodes `127.0.0.1:11470`** (`tracksData.js:2`) — breaks on non-default
   host; fix in the reimplementation.
7. **`/settings` must emit `remoteHttps` as `""`, not `null`** (`serde_ext.rs` empty-
   string-as-null quirk), or core's deserialize diverges.

## The `/hlsv2` decision

The transcoder (`/hlsv2/*` + real `/device-info`) is **6-10 weeks of byte-exact ffmpeg
orchestration** (fMP4 segmenter, transcode-vs-transmux predicate, ~40-branch arg builder,
hwaccel profile table). It is **entirely orthogonal to the torrent engine** and rewriting
it buys **zero** security improvement (ffmpeg stays a C subprocess).

**Plan of record for v1: delegate.** librqbit serves the media file over local HTTP; a
slim transcode front-end (the existing JS `/hlsv2` stack, run as a sidecar) consumes that
URL. This yields the *full contract* immediately. A native Rust transcoder is a separate,
explicitly-budgeted ~2-month project, not a line item here.

> Consequence to accept: under the sidecar path, a closed-source component remains **for
> transcoding only**. It no longer parses hostile peer data (librqbit does), so the
> threat you cared about is gone regardless.

## Status

Planning complete. Awaiting green-light on the two open decisions in the checklist
(local-addon confirmed in-scope by "full"; `/hlsv2` sidecar-vs-native).
