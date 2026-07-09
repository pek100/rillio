# Rillio

Rillio is a hard fork of the Stremio client, consolidated from five upstream
Stremio repositories into a single monorepo. **There is no upstream merge path** —
history was squashed and the repos were restructured. (The name comes from *rill*,
a small quiet stream — a nod to the privacy-first approach.)

> **Note:** the architecture sections below are stale (they predate the Tauri
> desktop shell with native mpv and the Rust streaming server that replaces
> `server.js`). They need a rewrite; treat the layout section as current.

## Layout

```
apps/
  web/                  React + TypeScript client (was Stremio/stremio-web)
packages/
  video/                Player abstraction layer (was Stremio/stremio-video)
  translations/         Locale strings (was Stremio/stremio-translations)
crates/
  core/                 Rust state machines + addon transport (was Stremio/stremio-core)
  core-web/             wasm-bindgen bridge, workspace package @rillio/core-web
  derive/               Model derive macro
  watched-bitfield/     Watched-episode bitfield
docker/
  streaming-server/     Hardened container for the torrent/streaming server
```

Both a **pnpm workspace** (`pnpm-workspace.yaml`) and a **cargo workspace**
(`Cargo.toml`) are rooted here.

## What the consolidation changed

Upstream, `stremio-web` consumed `@stremio/stremio-core-web` and
`@stremio/stremio-video` **from the npm registry** — so editing the Rust core did
nothing to the app. Here they are `workspace:*` links backed by local builds:

```
crates/core  ──(wasm-pack)──>  crates/core-web  ──(workspace:*)──>  apps/web
packages/video ───────────────────(workspace:*)──────────────────>  apps/web
```

Editing `crates/core/src` now changes the app after `pnpm build:wasm`.

Other deltas from upstream:

- `crates/core-web/scripts/build.sh` replaced by a cross-platform `build.mjs`
  (the `sh` script could not run on Windows).
- Cargo workspace re-rooted; path deps rewritten (`../derive`, `../core`).
- Per-repo `.github/` CI configs dropped — a fork writes its own.
- The Qt5 desktop shell (`stremio-shell`) was **dropped entirely**. It was
  v4.4.183 against a v5 web client, and upstream carried 374 MB of prebuilt
  binaries plus Smart Code's code-signing certificates alongside it.
  `packages/video/src/ShellVideo` remains but is unreachable without a shell.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node | >= 22 | |
| pnpm | >= 11 | `corepack prepare pnpm@11.10.0 --activate` |
| Rust | 1.95 | pinned by `rust-toolchain.toml` |
| wasm-pack | >= 0.15 | `cargo install wasm-pack --locked` |
| Docker | >= 28 | Phase 3 only |

## Build

```sh
pnpm install
pnpm build:wasm      # cargo + wasm-pack -> crates/core-web
pnpm build           # build:wasm, then webpack apps/web
pnpm start           # dev server
```

## Caveats

- **There is no desktop shell.** Playback runs in the browser via
  `packages/video/src/HTMLVideo`, so media decoding is the browser's, not a
  bundled mpv/FFmpeg. Reintroducing a shell means reintroducing a host decoder.
- **`server.js` is a closed-source blob**, fetched from
  `https://dl.strem.io/server/v4.20.16/desktop/server.js`. It cannot be audited.
  This is the primary motivation for `docker/streaming-server`.

## Security model

> Status: not yet implemented. `docker/streaming-server/` is a placeholder.

The container will isolate the untrusted **parser**: `server.js` (hostile
bencode, HTTP surface) and addon fetches. Media **decode** happens outside it.
Downloaded torrent payloads are inert data and were never the threat; the parser
and the decoder are.

With the Qt shell removed, the decoder is the **browser's**, which is patched by
the browser vendor. The only FFmpeg this project ships is the one inside the
container image, used by `server.js` for transcoding — keep its base image
current. There is no host FFmpeg to maintain.
