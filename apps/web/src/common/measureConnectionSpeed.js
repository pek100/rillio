// Ephemeral internet download-speed probe, used ONLY to word the slow-download
// message honestly (is the SOURCE slow, or the whole CONNECTION?). The result is
// never stored: it lives in memory for the session and is discarded on reload.
// DNS is already encrypted (DoH in the shell), and we hit a single reputable,
// CORS-friendly endpoint (Cloudflare's speed-test file, which returns
// Access-Control-Allow-Origin: *). Everything is guarded by a timeout and a
// catch, so a failed probe never blocks or crashes, the caller falls back to the
// source-slow wording.

// Cloudflare returns exactly `bytes` of octet-stream with permissive CORS.
// Verified: GET .../__down?bytes=N -> 200, Content-Length N, ACAO: *.
const SPEED_TEST_URL = 'https://speed.cloudflare.com/__down?bytes=';
// 25 MB is enough to ride past TCP slow-start for a representative rate without
// being a heavy download on a metered link.
const SPEED_TEST_BYTES = 25000000;
const SPEED_TEST_TIMEOUT_MS = 15000;

// Measure download throughput in BYTES per second. Resolves to null on any
// failure (timeout, network error, abort, missing body) so callers can fall
// back rather than crash.
const measureConnectionSpeed = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SPEED_TEST_TIMEOUT_MS);
    const started = Date.now();
    try {
        const response = await fetch(`${SPEED_TEST_URL}${SPEED_TEST_BYTES}`, {
            signal: controller.signal,
            cache: 'no-store',
        });
        if (!response || !response.ok || !response.body) {
            return null;
        }

        const reader = response.body.getReader();
        let received = 0;
        // Stream the body so the measurement reflects the whole transfer, not
        // just time-to-first-byte.
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            received += value?.length ?? 0;
        }

        const elapsedSec = (Date.now() - started) / 1000;
        if (elapsedSec <= 0 || received <= 0) {
            return null;
        }

        return received / elapsedSec;
    } catch (_error) {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

// One probe per session, cached in memory (never persisted). Concurrent callers
// share the same in-flight promise so the slow screen never fires two probes.
let cachedProbe = null;
const measureConnectionSpeedOnce = () => {
    if (cachedProbe === null) {
        cachedProbe = measureConnectionSpeed();
    }
    return cachedProbe;
};

module.exports = { measureConnectionSpeed, measureConnectionSpeedOnce, SPEED_TEST_BYTES };
