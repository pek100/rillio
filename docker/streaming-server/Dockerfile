# syntax=docker/dockerfile:1.7
#
# Hardened container for the Stremio streaming server.
#
# THREAT MODEL
# ------------
# server.js is a 6.3 MB closed-source bundle fetched from dl.strem.io. It parses
# hostile bencode from arbitrary peers, exposes an HTTP surface, spawns ffmpeg,
# and fetches remote addon manifests. It is the single least trustworthy
# component in this project and it cannot be audited.
#
# This image exists to contain it. Media *decoding* happens in the browser,
# outside this container -- that is an accepted tradeoff, not an oversight.
# Downloaded torrent payloads are inert data and were never the threat.
#
# The image intentionally runs on a shell-bearing base rather than distroless:
# server.js shells out to `df '<cachePath>'` to compute free disk space.

# ---------------------------------------------------------------------------
# Stage 1: fetch and verify the blob.
# ---------------------------------------------------------------------------
FROM alpine:3.22 AS fetch

# Bump both together. The checksum is the only thing standing between you and
# whatever dl.strem.io serves tomorrow.
ARG SERVER_VERSION=4.20.16
ARG SERVER_SHA256=88e887f058765f0e3dbc636829e7687ab80759c392eb9a64df457c8f9fc86e28

RUN apk add --no-cache curl \
    && curl -fsSL --proto '=https' --tlsv1.2 \
         -o /tmp/server.js \
         "https://dl.strem.io/server/v${SERVER_VERSION}/desktop/server.js" \
    && echo "${SERVER_SHA256}  /tmp/server.js" | sha256sum -c - \
    && test -s /tmp/server.js

# ---------------------------------------------------------------------------
# Stage 2: runtime.
# ---------------------------------------------------------------------------
FROM node:22-alpine3.22

# ffmpeg/ffprobe land at /usr/bin, which server.js already searches. We set the
# env vars explicitly anyway so a PATH change can't silently pick something else.
# Alpine 3.22 ships ffmpeg 6.1.x -- not the FFmpeg 4.x (avcodec-58) the upstream
# desktop shell bundled. This is the only ffmpeg the project ships; rebuild
# periodically to pick up base-image patches.
RUN apk add --no-cache ffmpeg tini \
    && ffmpeg -version | head -n1

# Create /app before COPY. If BuildKit creates the parent implicitly, it applies
# --chmod to the directory too -- 0444 leaves it without the execute bit, and the
# unprivileged `node` user then cannot traverse it ("Cannot find module").
RUN mkdir -p /app
COPY --from=fetch --chown=root:root --chmod=0444 /tmp/server.js /app/server.js

ENV NODE_ENV=production \
    PORT=11470 \
    APP_PATH=/data \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    FFPROBE_BIN=/usr/bin/ffprobe \
    # server.js only sends CORS headers when the Origin matches a hardcoded
    # allowlist (*.strem.io, *.stremio.net, ..., and 127.0.0.1|localhost:11470).
    # Our client is served from a different origin, so every request would be
    # blocked. NO_CORS makes it answer `Access-Control-Allow-Origin: *`.
    # Safe only because this port is published to loopback -- see compose.yaml.
    NO_CORS=1 \
    # Suppresses the outbound call to https://api.strem.io/api/certificateGet
    # that the casting feature makes on startup. Unset this if you want
    # Chromecast; it costs you an egress dependency on Stremio's API.
    CASTING_DISABLED=1

# The `node` user (uid 1000) ships with the base image.
RUN mkdir -p /data && chown node:node /data
USER node

WORKDIR /app
VOLUME ["/data"]
EXPOSE 11470

# GET /settings is the endpoint stremio-core probes to decide the server is up
# (crates/core/src/models/streaming_server.rs:450). Health-check the real contract.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:11470/settings >/dev/null 2>&1 || exit 1

# tini reaps the ffmpeg children server.js spawns; without it they zombify.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/server.js"]
