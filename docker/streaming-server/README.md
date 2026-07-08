# Hardened streaming server

Runs Stremio's `server.js` — the torrent engine and transcoder — inside a
container, so the least trustworthy component in the project cannot reach the
host filesystem.

```sh
docker compose -f docker/streaming-server/compose.yaml up -d --build
curl http://127.0.0.1:11470/settings
```

The app then talks to `http://127.0.0.1:11470` exactly as it did when the server
ran as a host process. The streaming server was **always** a network boundary;
this only changes what is on the other side of it.

## What is and isn't contained

| Threat | Contained? |
|---|---|
| `server.js` parsing hostile bencode / peer traffic | **yes** |
| `server.js` HTTP surface | **yes** |
| Addon manifest fetches | **yes** |
| `ffmpeg` transcoding attacker-supplied media | **yes** |
| Browser decoding the resulting video stream | **no** — accepted |
| A downloaded payload executing itself | n/a — it never could |

The last row is the important one. Torrent payloads are inert data. A `.mkv` on
disk does not run. The threat was always the *parser* and the *decoder*, never
the bytes at rest. This container isolates the parser. The decoder is your
browser's, patched by your browser vendor.

If you ever reintroduce a desktop shell with a bundled mpv/FFmpeg, you
reintroduce a host decoder — and that decoder becomes the weakest link, not this
container.

## The blob

`server.js` is 6.3 MB of closed-source, webpack-bundled JavaScript from
`dl.strem.io`. There is no published source. The `Dockerfile` pins both the
version and a SHA-256:

```
ARG SERVER_VERSION=4.20.16
ARG SERVER_SHA256=88e887f058765f0e3dbc636829e7687ab80759c392eb9a64df457c8f9fc86e28
```

The build fails closed if the bytes change. **Bump both together, never one.**
To adopt a new version, download it, hash it, read the diff of what env vars and
endpoints it touches, then update.

## Configuration derived from the blob

These were read out of `server.js`, not guessed:

| Variable | Value | Why |
|---|---|---|
| `PORT` | `11470` | `process.env.PORT \|\| null` |
| `APP_PATH` | `/data` | overrides the `$HOME/.stremio-server` default |
| `FFMPEG_BIN` / `FFPROBE_BIN` | `/usr/bin/…` | set explicitly so `PATH` can't decide |
| `NO_CORS` | `1` | see below |
| `CASTING_DISABLED` | `1` | drops the startup call to `api.strem.io` |

### Why `NO_CORS=1` is required, and why it's safe here

`server.js` only sends CORS headers when the request `Origin` matches a
hardcoded allowlist — `*.strem.io`, `*.stremio.net`, `*.stremio.com`,
`stremio.github.io`, `peario.xyz`, and `(127.0.0.1|localhost):11470`. Our client
is served from a different origin (`https://localhost:8080` in dev), so **every
request from it would be blocked**. `NO_CORS=1` makes the server answer
`Access-Control-Allow-Origin: *`.

That is only acceptable because `compose.yaml` publishes the port to
**`127.0.0.1:11470`**, not `0.0.0.0`. Change that and you have handed every host
on your network an unauthenticated torrent engine. Don't.

## Containment specifics

- `read_only: true` — immutable rootfs
- `cap_drop: [ALL]` — it binds a port above 1024 and needs nothing else
- `no-new-privileges:true`
- `USER node` (uid 1000)
- `/tmp` is `tmpfs` with `noexec,nosuid,nodev` — the one writable path an ffmpeg
  bug could target
- `/data` is a named volume for cache and settings. It is **not** `noexec`:
  Docker cannot portably apply mount flags to named volumes. Contents are inert
  data, and the process has no capabilities, so the residual risk is something
  *outside* the container executing a downloaded file.
- `mem_limit: 2g`, `pids_limit: 512` — bounds a decompression bomb or runaway transcode
- `tini` as PID 1, to reap the ffmpeg children `server.js` spawns

The base image is **not** distroless, deliberately: `server.js` shells out to
`df '<cachePath>'` to compute free disk space, so it needs `/bin/sh` and
coreutils.

## Known tradeoffs

**Leech-only.** No inbound torrent port is published. The engine makes outbound
connections and does not accept incoming peers, so swarm participation is
degraded. Publishing a listen port would fix that at the cost of an inbound
network surface on the least trustworthy process here. Judgment call; currently
biased toward containment.

**No VPN.** Torrent egress leaves via the container's default network, i.e. your
IP. If that matters, put this service behind a VPN sidecar (`network_mode:
service:vpn`).

**`/network-info` reports the bridge IP.** `stremio-core` calls this endpoint
(`streaming_server.rs:483`); inside the container it answers with the Docker
network address (e.g. `172.20.0.2`), not your LAN address. Harmless while
`CASTING_DISABLED=1`, since nothing on the LAN needs to reach back. If you
re-enable casting you will also need `network_mode: host`, which forfeits the
network isolation this container provides.

**`ffmpeg` version tracks the base image.** Alpine 3.22 ships FFmpeg **6.1.2**
(verified at build). This is the only FFmpeg the project ships — the upstream
desktop shell bundled 4.x (`avcodec-58`) from ~2021, which is one reason that
shell is gone. Rebuild periodically to pick up base-image patches.
