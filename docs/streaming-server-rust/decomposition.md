<!--
id: streaming-server-rust-decomposition
tags: [streaming-server, rust, funnel, decomposition]
related_files: [docs/streaming-server-rust/README.md]
checklist: checklists/streaming-server-rust.md
status: planning
last_sync: 2026-07-08
-->

# $FUNNEL decomposition

Recursive decomposition to atomic units (single responsibility, obvious I/O). Leaf nodes
marked ✓ are directly implementable and independently testable against the container oracle.

```
[Rust streaming server: crates/streaming-server]
│
├── [Crate shape]
│   ├── lib.rs: `pub async fn router(Config) -> axum::Router`  ✓ (embeddable entry)
│   ├── bin/serve.rs: standalone host binding :11470          ✓ (dev/test only)
│   ├── config.rs: cache dir, port, bind addr, feature flags  ✓
│   └── oracle-diff test harness: same req → container vs self ✓ (underpins every milestone)
│
├── [M0: control plane — no engine, no ffmpeg]
│   ├── GET/POST /settings (remoteHttps="" quirk)             ✓
│   ├── GET /network-info (non-internal IPv4 enumeration)     ✓
│   ├── GET /device-info → {availableHardwareAccelerations:[]}✓ (honest stub)
│   ├── GET /casting → [], POST /casting/:dev/player → no-op  ✓
│   ├── GET /get-https (proxy strem.io cert API or 501)       ✓
│   └── GET /heartbeat, /, /favicon.ico                       ✓
│
├── [M1: torrent engine — librqbit]
│   ├── librqbit Session bootstrap (cache dir, no listen port)✓
│   ├── POST /create (blob only; DROP both `from` SSRF halves)✓
│   ├── POST /:infoHash/create
│   │   ├── magnet/infohash → Session::add_torrent            ✓
│   │   ├── peerSearch handling                               ✓
│   │   ├── guessFileIdx → guessedFileIdx (largest file)      ✓
│   │   └── fileMustInclude selector + 500ms ReDoS guard      ✓
│   ├── GET/HEAD /:infoHash/:idx (+/*)
│   │   ├── idx union: int | -1 | url-encoded filename        ✓
│   │   ├── librqbit FileStream (AsyncRead+AsyncSeek)         ✓
│   │   ├── Range: first-range-only, no-416→200, prewarm      ✓
│   │   ├── enginefs-prio header → piece priority             ✓
│   │   ├── ?external→307, ?download→disposition, ?subtitles  ✓
│   │   └── fixed headers + sendDLNAHeaders + mime.lookup     ✓
│   └── GET /:infoHash/remove, /removeAll → Session::delete   ✓
│
├── [M2: stats fidelity shim]
│   ├── /:infoHash/:idx/stats.json (per-file)                 ✓
│   ├── /:infoHash/stats.json (torrent-level, VIDEO-ONLY)     ✓
│   ├── /stats.json (aggregate, no ?sys)                      ✓
│   ├── real: files[], streamName, guessedFileIdx, speeds     ✓
│   └── stub 0/[]: unchoked, unique, wires[], sources[], …    ✓
│
├── [M3a: /proxy subsystem — CRITICAL PATH]
│   ├── header injection d=/h=/r= options blob                ✓
│   ├── ≤5 redirect following                                 ✓
│   ├── m3u8 detection → strip content-length, force chunked  ✓
│   ├── playlist body URL rewriter (recompute virtualRoot)    ✓ (the hard atom)
│   └── SSRF policy: allowlist / explicit opt-in (NOT blanket rejectUnauthorized:false) ✓
│
├── [M3b: non-ffmpeg support routes]
│   ├── GET /opensubHash (head+tail hash of ?videoUrl)        ✓
│   ├── GET /subtitles.:ext (SRT→VTT)                         ✓
│   ├── GET /tracks/:url, /subtitlesTracks (JS demux port)    ✓ (drop hardcoded host)
│   └── GET /yt/:id → 301 redirect (best-effort; ytdl churn)  ✓
│
├── [M4: local-addon transport — core consumes it]
│   ├── GET /local-addon/manifest.json                        ✓
│   └── GET /local-addon/:resource/:type/:id/:extra?          ✓
│
├── [M5: archives (optional)]
│   ├── POST /create/:key + ALL /create (key handshake)       ✓
│   ├── waitForKey wait-state                                 ✓
│   ├── GET /stream/:key/:fileName + Range                    ✓
│   ├── per-compression offset math (stored vs deflate)       ✓
│   ├── lz-string compressToEncodedURIComponent codec         ✓ (NOT base64)
│   └── /ftp, /nzb (only if a consumer demands)               ✓
│
└── [M6: /hlsv2 — DELEGATE, do not rewrite]
    ├── librqbit media file exposed over local HTTP           ✓
    ├── sidecar transcode front-end consumes that URL         ✓
    └── [native Rust transcoder] ✗ NOT ATOMIC — separate ~2-month project, deferred
```

## Atomicity notes

- The one genuinely hard engine atom — Range→piece-priority with reads that *park* until
  a piece verifies, and seeks that re-prioritize — is librqbit's headline `FileStream`
  feature, not something we hand-roll.
- The one genuinely hard support atom — the `/proxy` m3u8 body rewriter — is why M3a is
  split out from the other support routes and re-baselined.
- `/hlsv2` native transcoding is explicitly **not** decomposed to atomic here: it is out
  of scope for v1 by decision, delegated to the sidecar.
