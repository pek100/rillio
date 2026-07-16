# Rillio

**Website: [rillio.app](https://rillio.app)**

Rillio is a hard fork of the Stremio client, consolidated from five upstream
Stremio repositories into a single monorepo. There is no upstream merge path:
history was squashed and the repos were restructured. (The name comes from *rill*,
a small quiet stream, for a calm, local-first app.)

Safety model in one line: torrent data is untrusted end to end - every file
path a torrent declares must resolve inside Rillio's own cache folder (a write
jail: absolute paths, drive prefixes, and `..` traversal are rejected and the
offending torrent is removed), the local API accepts mutations only from the
app's own origin, and updates are signed. Details below.

## Why the security posture exists (the receipts)

This app category handles attacker-controlled input by definition: torrents,
subtitles and addon responses all come from strangers. The hardening is aimed
at attack classes that have actually shipped, with honest framing of how
common each is:

- **Crafted torrents escaping the download folder.** File names in a torrent
  can attempt `..` traversal or absolute paths; libtorrent documented and fixed
  this class in [2014](https://blog.libtorrent.org/2014/12/filenames/), and
  path-handling bugs keep recurring in clients (e.g. the 2025 Deluge advisories,
  [GHSL-2024-188..191](https://securitylab.github.com/advisories/GHSL-2024-188_GHSL-2024-191_Deluge/)).
  Rillio validates every declared path against the cache root on top of
  librqbit's own parse-time check, and removes the torrent on violation.
- **Parser memory corruption reaching code execution.** uTorrent's
  [CVE-2020-8437](https://mavlevin.com/2020/09/20/utorrent-cve-2020-8437-vulnerability-and-exploit-overview)
  achieved RCE from a crafted bencoded dictionary. Rillio's engine and parsers
  are Rust: the overflow class is removed at the language level. That is not
  immunity (logic bugs exist in every language); it deletes the most common
  exploit class.
- **The subtitle supply chain.** Check Point's 2017
  ["Hacked in Translation"](https://research.checkpoint.com/2017/hacked-in-translation/)
  demonstrated RCE via crafted subtitle files in VLC, Kodi, Popcorn Time and
  Stremio - roughly 200 million installs of vulnerable players at the time,
  deliverable through poisoned subtitle-repository rankings with no user
  interaction. Long patched, but it is the proof that these apps are a real
  target surface, not a hypothetical one.
- **Honest prevalence.** In-app parser exploits are the rarer threat; most
  malware around media downloads arrives as fake installers and bundled
  executables from untrustworthy websites. Rillio avoids that class
  structurally: it never executes downloaded content, it only demuxes media
  into the player.

None of this makes any software invulnerable, and this README will not claim
otherwise. It means the known, shipped attack classes for this category each
have a specific, auditable countermeasure here.

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
  composited into the app window: native 4K HEVC playback, HDR passthrough on
  HDR displays, and Dolby Vision rendering with the RPU metadata applied by
  libplacebo (exact output depends on the stream profile, GPU and display chain).
  Upstream
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

Player features beyond playback fidelity (as of v0.1.22):

- **Trickplay**: hover the seek bar for real decoded frame previews, generated
  by a second in-process libmpv instance seeking keyframes at thumbnail size.
- **Chapter-segmented timeline**: real chapter marks when the file carries
  them (titles in the hover card), merged with dialogue-gap boundaries from
  external subtitles and a background visual scene scan for files with neither.
- **Skip intro/outro**: file chapters plus the AniSkip and TheIntroDB
  community databases, surfaced as a single Skip pill.
- **Smart track selection**: audio/subtitle defaults are scored (language,
  full-dialogue over signs/commentary, forced-flag handling), not first-listed.
- **GPU frosted glass**: the player panels blur the live video inside mpv's
  own render pipeline (a libplacebo user shader), downstream of the HDR/DV
  color pipeline so passthrough is untouched.

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

Torrent data is treated as untrusted at the filesystem level too: every file
path a torrent declares is validated to resolve under the cache root before
anything is streamed (absolute paths, drive prefixes, and `..` traversal are
rejected), on top of librqbit-core's own parse-time path-traversal check, and a
torrent that fails the check is removed instead of written. A malicious
`.torrent` cannot plant files anywhere else on disk.

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
