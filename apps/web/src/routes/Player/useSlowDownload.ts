// Copyright (C) 2017-2026 Smart code 203358507

import React from 'react';
import { measureConnectionSpeedOnce } from 'rillio/common/measureConnectionSpeed';

// When a torrent has peers but the download rate stays near zero for a sustained
// window, the bare "Initializing" panel does not help. This hook detects that
// sustained-slow state and, once, runs an ephemeral internet speed test to word
// the escalation honestly: is the SOURCE slow (try another), or is the whole
// CONNECTION slow (another source will not help)? All inputs are guarded, if
// stats are missing we never escalate.

// A rate below this (with peers present) counts as "slow". ~51 KB/s: well under
// what any watchable stream needs to keep buffered.
const SLOW_SPEED_BYTES_PER_SEC = 50 * 1024;
// The rate must stay slow this long before we escalate, so a brief dip during
// peer discovery does not flip the panel.
const SLOW_SUSTAINED_MS = 25000;
// Measured connection throughput at or above this is treated as healthy (so the
// bottleneck is the source, not the link). ~1.5 MB/s (~12 Mbps): comfortably
// above the slow-torrent threshold, below a typical broadband line.
const HEALTHY_CONNECTION_BYTES_PER_SEC = 1.5 * 1024 * 1024;

// The web's ultra-fast torrent profile (mirrors TORRENT_PROFILES['ultra fast']
// in Settings/Streaming/useStreamingOptions). The slow-screen "Fast mode" action
// reuses the EXISTING profile mechanism rather than inventing a parallel flag.
const ULTRA_FAST_PROFILE = {
    btDownloadSpeedHardLimit: 78643200,
    btDownloadSpeedSoftLimit: 8388608,
    btHandshakeTimeout: 25000,
    btMaxConnections: 400,
    btMinPeersForStable: 10,
    btRequestTimeout: 6000,
};

type UseSlowDownloadArgs = {
    core: { transport: CoreTransport } | null;
    infoHash: string | null;
    hasStatistics: boolean;
    peers?: number;
    speedBytesPerSec?: number;
    streamingSettings: StreamingServerSettings | null;
};

const isUltraFast = (settings: StreamingServerSettings | null) => {
    return !!settings &&
        settings.btMaxConnections === ULTRA_FAST_PROFILE.btMaxConnections &&
        settings.btDownloadSpeedHardLimit === ULTRA_FAST_PROFILE.btDownloadSpeedHardLimit;
};

const useSlowDownload = ({ core, infoHash, hasStatistics, peers, speedBytesPerSec, streamingSettings }: UseSlowDownloadArgs) => {
    const [escalated, setEscalated] = React.useState(false);
    // null = not yet probed / probing; true = connection slow; false = connection healthy.
    const [connectionSlow, setConnectionSlow] = React.useState<boolean | null>(null);
    const slowTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const probeStarted = React.useRef(false);

    const isSlowNow = hasStatistics === true &&
        typeof peers === 'number' && peers > 0 &&
        typeof speedBytesPerSec === 'number' && speedBytesPerSec >= 0 &&
        speedBytesPerSec < SLOW_SPEED_BYTES_PER_SEC;

    const clearTimer = () => {
        if (slowTimer.current !== null) {
            clearTimeout(slowTimer.current);
            slowTimer.current = null;
        }
    };

    // Reset when the stream changes (a new torrent gets a fresh evaluation).
    React.useEffect(() => {
        setEscalated(false);
        setConnectionSlow(null);
        probeStarted.current = false;
        clearTimer();
    }, [infoHash]);

    // Arm/disarm the sustained-slow timer as the rate crosses the threshold.
    React.useEffect(() => {
        if (isSlowNow) {
            if (slowTimer.current === null && !escalated) {
                slowTimer.current = setTimeout(() => {
                    slowTimer.current = null;
                    setEscalated(true);
                }, SLOW_SUSTAINED_MS);
            }
        } else {
            // Recovered before or after escalating: cancel and de-escalate.
            clearTimer();
            if (escalated) {
                setEscalated(false);
            }
        }
    }, [isSlowNow, escalated]);

    // Clean up any pending timer on unmount.
    React.useEffect(() => clearTimer, []);

    // Once escalated, probe the connection exactly once (cached for the session).
    // A failed/null probe means "assume the source is slow", the safe, actionable
    // default, so a broken speed test never hides the actionable message.
    React.useEffect(() => {
        if (!escalated || probeStarted.current) {
            return undefined;
        }
        probeStarted.current = true;
        let cancelled = false;
        measureConnectionSpeedOnce()
            .then((bytesPerSec: number | null) => {
                if (cancelled) {
                    return;
                }
                setConnectionSlow(typeof bytesPerSec === 'number' && bytesPerSec < HEALTHY_CONNECTION_BYTES_PER_SEC);
            })
            .catch(() => {
                if (!cancelled) {
                    setConnectionSlow(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [escalated]);

    const fastModeAvailable = !!streamingSettings && !isUltraFast(streamingSettings);

    const switchToFastMode = React.useCallback(() => {
        if (!core || !streamingSettings) {
            return;
        }
        core.transport.dispatch({
            action: 'StreamingServer',
            args: {
                action: 'UpdateSettings',
                args: {
                    ...streamingSettings,
                    ...ULTRA_FAST_PROFILE,
                },
            },
        });
    }, [core, streamingSettings]);

    return { escalated, connectionSlow, fastModeAvailable, switchToFastMode };
};

export default useSlowDownload;
