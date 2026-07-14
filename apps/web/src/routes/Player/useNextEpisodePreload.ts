// Copyright (C) 2017-2026 Smart code 203358507

import React from 'react';
import useCacheDownload from 'rillio/common/useCacheDownload';
import useProfile from 'rillio/common/useProfile';
import useToast from 'rillio/common/Toast/useToast';
import { notifyCacheChanged } from 'rillio/common/cacheEvents';
import { getPreloadPromptEnabled } from 'rillio/common/nextEpisodePreloadPrefs';

// Offers to preload the NEXT episode's torrent into the local cache while the
// current one plays, so the binge transition starts instantly. The prompt shows
// twice at most: once at episode start (through initial loading plus the first
// 30s of playback, whichever lasts longer) and once 10 minutes before the end.
// Accepting hides the prompt for the rest of the episode, schedules the
// download behind a short grace timer and shows a toast with a Cancel button
// (cancelling aborts for this episode only). Cancel on the prompt itself just
// hides the currently showing slot, nothing persisted: the T-minus-10min
// reminder can still appear later in the same episode, and the next episode
// prompts again; the Settings toggle is what turns it off globally.
// Torrent-only: a next episode without a derivable torrent stream simply
// never prompts.

// The start prompt stays up through initial loading plus this long into
// playback, whichever lasts longer.
const START_PROMPT_PLAYBACK_MS = 30000;
// Accepting schedules the download behind this grace delay; cancelling from
// the toast within it means the download never starts, no cache churn at all.
const ACCEPT_GRACE_MS = 3000;
// The cancel toast outlives the grace window so a late click can still
// best-effort pause an already-started download.
const CANCEL_TOAST_TIMEOUT_MS = 6000;
// The reminder prompt appears this close to the end of the episode.
const END_PROMPT_REMAINING_MS = 10 * 60 * 1000;
// An armed paused-start that is never consumed (user backed out mid-transition)
// must not leak into an unrelated playback hours later.
const PAUSED_START_TTL_MS = 30 * 60 * 1000;

type PendingPausedStart = {
    videoId: string;
    expiresAt: number;
};

type AcceptedDownload = {
    infoHash: string | null;
    started: boolean;
    // Was this torrent already in the cache before we touched it? Cancel deletes
    // what the preload CREATED, so it must never delete a copy the user already
    // had. Defaults true: until the check answers, cancel takes the safe path.
    preExisting: boolean;
};

type UseNextEpisodePreloadArgs = {
    player: {
        selected: { streamRequest?: ResourceRequest | null; metaRequest?: ResourceRequest | null } | null;
        nextVideo: { streams?: Stream[]; id?: string } | null;
    };
    video: {
        state: any;
        setPaused: (paused: boolean) => void;
    };
};

// The paused-start handoff must survive the player route replacing itself with
// the next episode's URL (React may remount the component on navigation), so it
// lives at module scope, not in component state. SPA-session-scoped by design.
let pendingPausedStart: PendingPausedStart | null = null;

const readPendingPausedStart = (): PendingPausedStart | null => {
    if (pendingPausedStart !== null && Date.now() > pendingPausedStart.expiresAt) {
        pendingPausedStart = null;
    }
    return pendingPausedStart;
};

const useNextEpisodePreload = ({ player, video }: UseNextEpisodePreloadArgs) => {
    const toast = useToast();
    const profile = useProfile();
    const downloadToCache = useCacheDownload();

    const currentVideoId = player.selected?.streamRequest?.path?.id ?? null;
    const seriesMetaId = player.selected?.metaRequest?.path?.id ?? null;

    // The preloadable stream: the core injects the binge-group matched stream as
    // the next video's ONLY stream (crates/core models/player.rs
    // next_video_update), so mirror core's Video::stream() rule (exactly one
    // stream) and require an infoHash, /cache/download is torrent-only.
    const nextStream = React.useMemo(() => {
        const streams = player.nextVideo?.streams;
        if (!Array.isArray(streams) || streams.length !== 1) {
            return null;
        }
        return typeof streams[0].infoHash === 'string' ? streams[0] : null;
    }, [player.nextVideo]);

    // answered = accepted for this episode; it silences both prompt slots
    // (start + T-minus-10min). Cancel never sets it.
    const [answered, setAnswered] = React.useState(false);
    const [accepted, setAccepted] = React.useState(false);
    // Cancel pressed while the end-window reminder was showing. Without this
    // the cancelled prompt would reappear on the next tick, inEndWindow stays
    // true for the remaining minutes. Episode-scoped, reset on a new episode.
    const [endWindowDismissed, setEndWindowDismissed] = React.useState(false);
    // The scheduled download: the grace timer plus what it needs to start (and
    // what a late cancel needs to stop). null = nothing accepted/pending.
    const acceptTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const acceptedDownload = React.useRef<AcceptedDownload | null>(null);
    const [startWindowOpen, setStartWindowOpen] = React.useState(true);
    const startHideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    // Guards the paused-start against a stale loaded=true from the PREVIOUS
    // episode: consume only after observing not-loaded for the current one.
    const sawUnloaded = React.useRef(false);
    const prevVideoId = React.useRef<string | null>(currentVideoId);

    const clearStartHideTimer = () => {
        if (startHideTimer.current !== null) {
            clearTimeout(startHideTimer.current);
            startHideTimer.current = null;
        }
    };

    const clearAcceptTimer = () => {
        if (acceptTimer.current !== null) {
            clearTimeout(acceptTimer.current);
            acceptTimer.current = null;
        }
    };

    // A new episode gets a fresh prompt evaluation.
    React.useEffect(() => {
        setAnswered(false);
        setAccepted(false);
        setEndWindowDismissed(false);
        setStartWindowOpen(true);
        sawUnloaded.current = false;
        acceptedDownload.current = null;
        clearStartHideTimer();
        clearAcceptTimer();
    }, [currentVideoId]);

    React.useEffect(() => () => {
        clearStartHideTimer();
        clearAcceptTimer();
    }, []);

    // The start window closes 30s after playback becomes possible (loaded), so
    // it spans the whole initial loading phase plus the first 30s of playback.
    React.useEffect(() => {
        if (video.state.loaded === true && startWindowOpen && startHideTimer.current === null) {
            startHideTimer.current = setTimeout(() => {
                startHideTimer.current = null;
                setStartWindowOpen(false);
            }, START_PROMPT_PLAYBACK_MS);
        }
    }, [video.state.loaded, startWindowOpen]);

    React.useEffect(() => {
        if (video.state.loaded !== true) {
            sawUnloaded.current = true;
        }
    }, [video.state.loaded, currentVideoId]);

    // A pending paused-start armed for one episode must not fire if the user
    // ends up playing something else instead.
    React.useEffect(() => {
        if (prevVideoId.current === currentVideoId) {
            return;
        }
        prevVideoId.current = currentVideoId;
        const pending = readPendingPausedStart();
        if (pending !== null && currentVideoId !== null && currentVideoId !== pending.videoId) {
            pendingPausedStart = null;
        }
    }, [currentVideoId]);

    // The accepted-preload transition: on the first loaded signal of the next
    // episode, start it paused and explain why. If it is not buffered yet the
    // normal Initializing screen shows in the meantime, then we still pause.
    React.useEffect(() => {
        const pending = readPendingPausedStart();
        if (pending !== null &&
            currentVideoId !== null &&
            currentVideoId === pending.videoId &&
            video.state.loaded === true &&
            sawUnloaded.current) {
            pendingPausedStart = null;
            video.setPaused(true);
            toast.show({
                type: 'success',
                title: 'Next episode is ready, just paused',
                timeout: 4000,
            });
        }
    }, [video.state.loaded, currentVideoId]);

    // Enablement is read from localStorage once per episode; flipping the
    // Settings toggle applies from the next episode on.
    const eligible = React.useMemo(() => {
        return nextStream !== null &&
            seriesMetaId !== null &&
            getPreloadPromptEnabled();
    }, [nextStream, seriesMetaId, currentVideoId]);

    const remainingMs = typeof video.state.time === 'number' && typeof video.state.duration === 'number' && video.state.duration > 0 ?
        video.state.duration - video.state.time
        :
        null;
    const inEndWindow = remainingMs !== null && remainingMs > 0 && remainingMs <= END_PROMPT_REMAINING_MS;

    const promptVisible = eligible && !answered &&
        (startWindowOpen || (inEndWindow && !endWindowDismissed));

    // Cancel from the toast. Before the grace timer fires: just clear it, the
    // download never starts. After: undo it on the server. Either way disarm the
    // accepted state and the paused-start handoff; no re-prompt this episode
    // (answered stays true).
    //
    // Undo means DELETE, not pause. Pausing left the entry (and its full-size
    // preallocated file - 9 GB for a 4K episode) sitting in the cache forever,
    // and worse, librqbit refuses to pause a torrent that is still hash-checking,
    // which is exactly where a cancel lands seconds after the download starts: it
    // did nothing at all. Delete stops the torrent AND reclaims the file.
    //
    // The exception is a torrent the user ALREADY had cached, which the preload
    // merely unpaused/pinned: deleting that would destroy their copy over a
    // toast click. Undo only our own change there.
    const cancelPreload = React.useCallback(() => {
        if (acceptTimer.current !== null) {
            clearAcceptTimer();
        } else if (acceptedDownload.current !== null && acceptedDownload.current.started) {
            const serverUrl = profile.settings.streamingServerUrl;
            const { infoHash, preExisting } = acceptedDownload.current;
            if (typeof serverUrl === 'string') {
                const path = preExisting ? 'cache/pause' : 'cache/delete';
                const body = preExisting ? { infoHash, paused: true } : { infoHash };
                fetch(new URL(path, serverUrl), {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                })
                    .then((resp) => {
                        if (!resp.ok) {
                            throw new Error(`${path} responded ${resp.status}`);
                        }
                        // The preload is gone: drop the top-nav dot now rather
                        // than on its next lazy tick.
                        notifyCacheChanged();
                    })
                    .catch((error) => {
                        console.error(`useNextEpisodePreload: ${path} failed`, error);
                        toast.show({
                            type: 'error',
                            title: 'Could not cancel the preload',
                            message: 'It may still be downloading; the Cached page can stop it.',
                            timeout: 4000,
                        });
                    });
            }
        }
        acceptedDownload.current = null;
        setAccepted(false);
        pendingPausedStart = null;
        toast.show({
            type: 'success',
            title: 'Preload cancelled',
            timeout: 3000,
        });
    }, [profile.settings.streamingServerUrl, toast]);

    // Accept hides the prompt immediately (answered silences both prompt
    // slots), arms the accepted state, schedules the actual download behind a
    // short grace delay and offers a toast with a Cancel button in its place.
    const accept = React.useCallback(() => {
        setAnswered(true);
        setAccepted(true);
        const stream = nextStream;
        const infoHash = stream !== null ? stream.infoHash ?? null : null;
        // preExisting starts TRUE so a cancel racing this check pauses rather than
        // deletes: the wrong guess must never be the destructive one.
        acceptedDownload.current = { infoHash, started: false, preExisting: true };
        // Does the user already have this cached? Cancel deletes what the preload
        // created and must not touch anything older, so settle that BEFORE we add
        // it ourselves - the grace delay below is exactly the room this needs.
        const serverUrl = profile.settings.streamingServerUrl;
        if (typeof serverUrl === 'string' && infoHash !== null) {
            fetch(new URL('cache/list', serverUrl))
                .then((resp) => {
                    if (!resp.ok) throw new Error(`cache/list responded ${resp.status}`);
                    return resp.json();
                })
                .then((list: { infoHash: string }[]) => {
                    if (acceptedDownload.current === null || acceptedDownload.current.infoHash !== infoHash) return;
                    acceptedDownload.current.preExisting = Array.isArray(list) &&
                        list.some((entry) => entry.infoHash === infoHash);
                })
                // Unknown: keep the safe default rather than risk deleting a copy
                // that might not be ours.
                .catch((error) => console.error('useNextEpisodePreload: cache/list failed', error));
        }
        clearAcceptTimer();
        acceptTimer.current = setTimeout(() => {
            acceptTimer.current = null;
            // useCacheDownload POSTs { infoHash, fileIdx } to /cache/download and
            // pins the torrent; it owns the started/failed toasts.
            const started = downloadToCache(stream);
            if (!started) {
                // Should be unreachable: the prompt only shows for a torrent stream.
                // useCacheDownload raises its own error toast, so this stays a log.
                console.error('useNextEpisodePreload: accepted but the next stream is not downloadable', stream);
                return;
            }
            if (acceptedDownload.current !== null) {
                acceptedDownload.current.started = true;
            }
        }, ACCEPT_GRACE_MS);
        toast.show({
            type: 'success',
            title: 'Preloading next episode',
            message: 'Starting in a moment.',
            timeout: CANCEL_TOAST_TIMEOUT_MS,
            action: { label: 'Cancel', onSelect: cancelPreload },
        });
    }, [nextStream, downloadToCache, cancelPreload, profile.settings.streamingServerUrl, toast]);

    // Cancel from the prompt: just hide whatever slot is currently showing,
    // nothing persisted. Closing the start window early never blocks the
    // T-minus-10min reminder; hiding the end-window reminder only applies
    // while it is actually showing (both can be true near the end of a short
    // episode, then a single Cancel closes both, the prompt was one).
    const dismiss = React.useCallback(() => {
        clearStartHideTimer();
        setStartWindowOpen(false);
        if (inEndWindow) {
            setEndWindowDismissed(true);
        }
    }, [inEndWindow]);

    // Called by Player.onEnded right before navigating to the next episode when
    // the preload was accepted, so THAT load starts paused.
    const armPausedStart = React.useCallback(() => {
        if (player.nextVideo !== null && typeof player.nextVideo.id === 'string') {
            pendingPausedStart = {
                videoId: player.nextVideo.id,
                expiresAt: Date.now() + PAUSED_START_TTL_MS,
            };
        }
    }, [player.nextVideo]);

    return { promptVisible, accepted, accept, dismiss, armPausedStart };
};

export default useNextEpisodePreload;
