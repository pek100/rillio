# Rillio

Rillio is a hard fork of the Stremio client, consolidated from five upstream
Stremio repositories into a single monorepo. There is no upstream merge path:
history was squashed and the repos were restructured. (The name comes from *rill*,
a small quiet stream, for a calm, local-first app.)

## Layout

```
apps/
  web/                  React + TypeScript client (was Stremio/stremio-web)
  desktop/src-tauri/    Tauri v2 desktop shell (Rust): owns the window, embeds the
                        streaming server in-process, and plays via native mpv
packages/
  video/                Player abstraction layer (was Stremio/stremio-video)
  translations/         Locale strings (was Stremio/stremio-translations)
crates/
  core/                 Rust state machines + addon transport (was Stremio/stremio-core)
  core-web/             wasm-bindgen bridge, workspace package @rillio/core-web
  derive/               Model derive macro
  watched-bitfield/     Watched-episode bitfield
  streaming-server/     Auditable Rust streaming/torrent server (replaces server.js)
landing/                Static marketing site (rillio.app)
```

Both a **pnpm workspace** (`pnpm-workspace.yaml`) and a **cargo workspace**
(`Cargo.toml`) are rooted here.

## Architecture

The desktop app is a **Tauri v2 shell** (`apps/desktop/src-tauri`) that:

- Loads the web client (`apps/web/build`) in a WebView2 window with its own chrome.
- Embeds the **Rust streaming server in-process** on `127.0.0.1:11470` (no
  container, no sidecar), replacing Stremio's closed-source `server.js`.
- Plays media with an **embedded native mpv** (libmpv loaded at runtime via FFI),
  composited into the app window: native 4K HEVC playback, true HDR passthrough
  on HDR displays, and full Dolby Vision (RPU-applied) rendering. Upstream
  Stremio hands these streams to an external player ("Stream is not supported");
  VLC discards the Dolby Vision RPU metadata; Rillio plays them in-app, in full
  quality, without the browser's codec limits. Dolby Vision support comes from
  libplacebo's open-source RPU implementation (the libdovi ecosystem), which
  processes the metadata carried in the stream itself; Rillio uses no Dolby SDK,
  is not Dolby certified, and claims no certification, the same
  open-implementation approach as the rest of the codec stack.
- Encrypts its DNS (DoH) and self-updates from signed GitHub Releases.
- Registers the `stremio://` and `rillio://` URL schemes, so a deep link (a
  content link, or an addon-install link from the community directory) opens the
  app and routes to the right screen.
- Sandboxes the WebView: a Content-Security-Policy plus an allowlist on the
  native mpv IPC (only the commands and properties the client actually uses) keep
  addon-driven content from reaching dangerous player commands or launching local
  programs. A single-instance guard avoids two shells fighting over the port.

The web client is shared. In a plain browser it decodes with `HTMLVideo` (the
browser's decoder); in the desktop shell it uses `ShellVideo`, which drives the
native mpv. The same React app runs both places.

## The Rust streaming server (replaces server.js)

`crates/streaming-server` is an auditable, in-process replacement for Stremio's
closed-source `server.js`. It uses **librqbit** for the torrent engine and serves
the same HTTP API, which was validated byte-for-byte against the reference
`server.js` during the port.

Its defaults are privacy-conscious, not an anonymity guarantee: it opens no
inbound listen port and no UPnP by default, so it isn't left accepting inbound
connections. BitTorrent still exposes your IP to peers, so bring your own
SOCKS5/VPN if you need that hidden.

The loopback API is also guarded against other web origins: it checks the request
Origin (rejecting arbitrary websites), keeps state-changing routes POST-only, and
routes subtitle/proxy fetches through an SSRF guard, so a page you open in a
browser cannot drive or read from your local server.

It is a separate cargo workspace because it pulls a large native tree (librqbit,
rustls, DHT) that needs `url >= 2.5`, which conflicts with the wasm crates'
`url 2.4.*` pin. Build it from its own directory.

## What the consolidation changed

Upstream, `stremio-web` consumed `@stremio/stremio-core-web` and
`@stremio/stremio-video` from the npm registry, so editing the Rust core did
nothing to the app. Here they are `workspace:*` links backed by local builds:

```
crates/core  --(wasm-pack)-->  crates/core-web  --(workspace:*)-->  apps/web
packages/video  ------------------(workspace:*)------------------>  apps/web
```

Editing `crates/core/src` changes the app after `pnpm build:wasm`. The upstream
Qt5 shell (`stremio-shell`) was dropped and replaced by the Tauri shell, so
`packages/video/src/ShellVideo` is reachable again and drives mpv instead of Qt.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node | >= 22 | |
| pnpm | >= 11 | `corepack prepare pnpm@11.10.0 --activate` |
| Rust | 1.95 | pinned by `rust-toolchain.toml` |
| wasm-pack | >= 0.15 | `cargo install wasm-pack --locked` |
| libmpv | v2 | `libmpv-2.dll` beside the desktop exe, for playback only |

## Build

Web client:

```sh
pnpm install
pnpm build:wasm                    # cargo + wasm-pack -> crates/core-web
pnpm --filter rillio run build     # webpack apps/web
```

Desktop app (Windows):

```sh
cd apps/desktop/src-tauri
cargo build --release              # rillio-desktop.exe, embeds apps/web/build
```

Playback needs `libmpv-2.dll` beside the exe (or point `RILLIO_LIBMPV` at one).
When running a dev build, set `RILLIO_STREAMING_CACHE_DIR` to a throwaway
directory so it does not share (and evict torrents from) an installed app's cache.

## Releases

Push a `v*` tag and `.github/workflows/release.yml` builds, signs, and publishes a
draft GitHub Release (installers + the updater manifest). Publish the draft to
ship it; existing installs update themselves.
