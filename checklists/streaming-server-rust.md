<!--
id: streaming-server-rust-checklist
tags: [streaming-server, rust, checklist, critical]
related_files: [docs/streaming-server-rust/README.md, docs/streaming-server-rust/decomposition.md]
doc: docs/streaming-server-rust/README.md
status: planning
last_sync: 2026-07-08
-->

# Checklist — Rust streaming server

Status keys: ☐ todo · ◐ in progress · ☑ done · ✗ dropped · ⚠ blocked

Estimates re-baselined after adversarial review. "one engineer familiar with Rust+tokio."
Every milestone's ship criterion is an **oracle diff** against `docker/streaming-server`.

## Decisions (resolved 2026-07-08)

- ☑ **D1 — `/local-addon` in scope: KEEP (M4).** Core consumes it as an addon transport
  (`addon_details.rs:82`); consistent with full-contract scope.
- ☑ **D2 — `/hlsv2`: SIDECAR-DELEGATE for v1.** librqbit serves the media file; the
  existing JS `/hlsv2` stack runs as a transcode-only sidecar consuming that URL. Native
  Rust transcoder deferred as a separate ~2-month project. A closed component remains for
  transcode only — it no longer parses hostile peer data, so the core threat is gone.

## M0 — Control-plane scaffold  ·  ~1 week  ·  ☑ DONE

- ☑ Crate skeleton `crates/streaming-server` (lib + `bin/serve.rs`), added to root Cargo workspace
- ☑ Oracle-diff test harness (`tests/oracle_diff.rs` — shape-diff vs container, volatile fields normalized)
- ☑ GET/POST `/settings` — **`remoteHttps=""` not null**; deserializes into core's `SettingsResponse`
- ☑ GET `/network-info` — `{availableInterfaces:[]}` (real enumeration deferred; empty is safe)
- ☑ GET `/device-info` → `{availableHardwareAccelerations:false}` (**corrected**: container returns `false`, not `[]`)
- ☑ GET `/casting` → `[]` (container 404s under CASTING_DISABLED; `[]` is the safe stub core accepts)
- ☐ GET `/get-https` (deferred — only reachable when remote-https is enabled; not on the load path)
- ☑ GET `/heartbeat`, `/` (307 → web UI), `/favicon.ico` (404)
- **Ship: MET.** App reads `Server Version: 5.0.0-rust+0.1.0` and **Online** in Settings, in a real browser, against the Rust server on :11470. No "server down" cascade. Oracle tests pass.

  _Corrections the oracle forced vs the plan: `/device-info` is boolean `false`; `/casting/` 404s under our container config. Both folded in._

## M1 — Torrent engine (librqbit)  ·  ~3-4 weeks  ·  ☑ DONE (streamed-bytes byte-diff PASSED)

- ☑ Pin `librqbit = "=8.1.1"`, own workspace (url 2.5 conflict w/ wasm crates), `default-tls` (NASM avoidance)
- ☑ Session bootstrap: leech-only (no listen port), DHT on, no persistence, `disable_dht_persistence`
- ☑ POST `/create` (hex `.torrent` blob) — both `from` branches dropped (local-read + SSRF)
- ☑ POST `/:infoHash/create` — magnet/infohash, `peerSearch`, `guessFileIdx`→`guessedFileIdx`
- ☑ … `fileMustInclude` selector (linear-time regex, skip-on-error; no timeout needed)
- ☑ GET/HEAD `/:infoHash/:idx` (+`/*`) — **idx union** (int | -1 GuessFileIdx | filename | `?f=`)
- ☑ … librqbit `FileStream` (parks until piece verifies; seek re-prioritizes — native)
- ☑ … Range: first-range-only, **no 416 (→200)**; `enginefs-prio`/prewarm are documented no-ops
- ☑ … `?external`→307, `?download`→disposition, `?subtitles`→CaptionInfo; DLNA (byte-exact space bug) + `mime_guess`
- ☑ GET `/:infoHash/remove`, `/removeAll` → `Session::delete` (delete_files=true — librqbit re-add constraint)
- **Ship: MET.** metadata/create from real BBB `.torrent`, full Range contract, file selection,
  remove→re-add — all verified. **Streamed-bytes byte-diff PASSED**: a 64 KiB slice at 1 MiB offset
  of the BBB `.mp4`, downloaded from live peers, is SHA-256-identical between the Rust server and the
  container (`658f00f8…`). (The earlier P2P block was a client-side AdGuard VPN, since disabled.)
  17 automated tests pass.

## M1.5 — ConfinedStorage (defense-in-depth on the cache)  ·  ☑ DONE

Tier 1 storage confinement. No Docker, pure-Rust, cross-platform, zero new prerequisites.
Wraps librqbit's filesystem storage via `SessionOptions.default_storage_factory`.

- ☑ Path guard — every file resolves under `cache_root`; rejects `..`, absolute, drive/root
  components. (librqbit-core already blocks `..` at parse — this asserts the invariant + covers
  absolute/drive and catches upstream regression.)
- ☑ No-exec — cache files created 0o644 on Unix; documented best-effort no-op on Windows
- ☑ Quota — total declared size capped at `Config.cache_size`; oversize torrents refused before any write
- ☑ Cache dir dedicated + outside PATH (already true)
- **Ship: MET.** 2 GB torrent refused under a 1 MB quota; 500 KB accepted; traversal path rejected;
  real BBB streaming still works through the wrapper with files confined under cache root. 27 tests pass.
- **Deferred:** Tier 2 (virtual-disk image), Tier 3 (process sandbox).

## M2 — Stats fidelity shim  ·  ~1 week  ·  ☐

- ☐ `/:infoHash/:idx/stats.json` (per-file — the one core uses)
- ☐ `/:infoHash/stats.json` (torrent-level — **video-only**; omitting it silently breaks filename/OpenSubtitles resolution)
- ☐ `/stats.json` (aggregate; **no `?sys`** host-info leak)
- ☐ Real: `files[]`, `streamName`, `guessedFileIdx`, `streamProgress`, speeds, peers
- ☐ Stub 0/[]: `unchoked`, `unique`, `connectionTries`, `wires[]`, `sources[]`, `peerSearchRunning`
- **Ship:** video's `fetchVideoParams` resolves filename + OpenSubtitles; stats overlay renders without NaN

## M3a — `/proxy` subsystem (critical path)  ·  ~2-3 weeks  ·  ☐

- ☐ `d=`/`h=`/`r=` header-injection options blob (core+video build identical URLs)
- ☐ Follow ≤5 redirects
- ☐ m3u8/mpegurl detection → strip `content-length`, force chunked
- ☐ **Playlist body URL rewriter** — rewrite every absolute URL back through the proxy (recompute `virtualRoot`)
- ☐ SSRF policy: allowlist / explicit opt-in — **not** blanket `rejectUnauthorized:false`
- **Ship:** proxied header-injection stream plays; a real m3u8 addon stream plays through the rewriter; diffs clean

## M3b — Non-ffmpeg support routes  ·  ~1-2 weeks  ·  ☐

- ☐ GET `/opensubHash` (head+tail hash of `?videoUrl`)
- ☐ GET `/subtitles.:ext` (SRT→WEBVTT)
- ☐ GET `/tracks/:url`, `/subtitlesTracks` — port JS demux; **drop hardcoded `127.0.0.1:11470`**
- ☐ GET `/yt/:id`(`.json`) — 301 redirect via ytdl (accept ongoing breakage)
- **Ship:** VTT conversion diffs clean; track enumeration works on a TV target

## M4 — Local-addon transport  ·  ~1 week  ·  ☐ (gated on D1)

- ☐ GET `/local-addon/manifest.json`
- ☐ GET `/local-addon/:resource/:type/:id/:extra?`
- **Ship:** core resolves the local addon (no `LOCAL_ADDON_NOT_ENABLED`); local catalog lists

## M5 — Archives  ·  ~2-3 weeks  ·  ☐ (optional)

- ☐ POST `/create/:key` + `ALL /create` key handshake; `waitForKey` wait-state
- ☐ GET `/stream/:key/:fileName` + Range
- ☐ Per-compression offset math (stored vs deflate; local-file-header offset)
- ☐ **lz-string `compressToEncodedURIComponent`** codec, sha256-keyed (NOT base64)
- ☐ `/ftp`, `/nzb` only if a consumer demands
- **Ship:** stream an inner file from a public zip torrent; diffs clean

## M6 — `/hlsv2` transcoding  ·  ☐ (gated on D2)

- ☐ Expose librqbit media file over local HTTP
- ☐ Bridge: sidecar transcode front-end consumes that URL
- ✗ Native Rust transcoder — **out of scope for v1** (separate ~2-month project)
- **Ship:** a source requiring transcode plays via the sidecar path

## Cross-cutting

- ☐ Drop `file://`/`url` HLS sources (SSRF/local-read)
- ☐ ffmpeg subprocess sandbox policy (seccomp/AppArmor, ro-FS, loopback-only, dropped caps) — the real security win, independent of language
- ☐ Wire the crate into the eventual native host (embeddable path)
- ☐ Keep `docker/streaming-server` as the reference oracle until M0-M4 diff clean, then as fallback
