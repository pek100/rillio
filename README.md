# Stremio (fork)

A hard fork of the Stremio client, consolidated from five upstream repositories
into a single monorepo. **There is no upstream merge path** — history was squashed
and the repos were restructured.

## Layout

```
apps/
  web/                  React + TypeScript client (was Stremio/stremio-web)
  shell/                Qt5 desktop shell (was Stremio/stremio-shell) — see caveats
packages/
  video/                Player abstraction layer (was Stremio/stremio-video)
  translations/         Locale strings (was Stremio/stremio-translations)
crates/
  core/                 Rust state machines + addon transport (was Stremio/stremio-core)
  core-web/             wasm-bindgen bridge, published as @stremio/stremio-core-web
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
- `apps/shell` vendors **source only**. Upstream committed 374 MB of prebuilt
  binaries and Smart Code's code-signing certificates; neither belongs here.

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

- **`apps/shell` is stale.** It is v4.4.183 (March 2026, Qt5) while `apps/web` is
  on the v5 beta line. The v5 desktop app uses a different shell entirely. Do not
  assume this tree builds a working v5 desktop app.
- **`server.js` is a closed-source blob**, fetched from
  `https://dl.strem.io/server/v4.20.16/desktop/server.js`. It cannot be audited.
  This is the primary motivation for `docker/streaming-server`.

## Security model

The container in `docker/streaming-server` isolates the untrusted **parser**:
`server.js` (hostile bencode, HTTP surface) and addon fetches. Media **decode**
still happens on the host for GPU acceleration — an accepted tradeoff. Downloaded
torrent payloads are inert data and were never the threat; the parser and the
decoder are.
