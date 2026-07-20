import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Info, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toPath } from 'rillio-router';
import { useCore } from 'rillio/core';
import { useProfile } from 'rillio/common';
import { fetchStreamingModeEnabled, postStreamingModeEnabled } from 'rillio/common/streamingMode';
import { Button, IconButton, ModalRoute, Switch, cn } from 'rillio/components/ui';
import AnimatedPercentage from 'rillio/components/ui/animated-percentage';
import SpeedChart from 'rillio/components/ui/speed-chart';
import useCachedTorrents, { CacheEntry } from './useCachedTorrents';

// Same parser the stream cards use: quality/HDR/languages are encoded in the
// entry name (the selected file's name for single-file selections, e.g. an
// episode filename, otherwise the torrent name - both carry the same tokens).
const { parseStream } = require('rillio/routes/MetaDetails/StreamsList/streamQuality');

type ParsedQuality = {
    resolution: number,
    hdr: boolean,
    flags: string[],
};

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const formatBytes = (bytes: number): string => {
    if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

const stateLabel = (entry: CacheEntry): string => {
    if (entry.state === 'error') return entry.error ? `Error: ${entry.error}` : 'Error';
    if (entry.state === 'paused') return 'Paused';
    if (entry.total > 0 && entry.downloaded >= entry.total) return 'Complete';
    if (entry.state === 'live') return 'Downloading';
    return 'Preparing';
};

// One tag treatment: a fixed-height pill that can never wrap or be squeezed, with
// the small-caps typography a two-letter label needs to read as deliberate.
const BADGE = 'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-surface px-2 text-[0.625rem] font-semibold uppercase leading-none tracking-wider text-fg-muted';

// Quality badges parsed from the torrent name, mirroring the stream cards.
const QualityBadges = ({ name }: { name: string }) => {
    const quality: ParsedQuality = useMemo(() => parseStream({ name, description: '' }), [name]);
    const resolution = quality.resolution >= 2160 ? '4K' :
        quality.resolution > 0 ? `${quality.resolution}p` : null;
    if (resolution === null && !quality.hdr && quality.flags.length === 0) {
        return null;
    }
    return (
        // shrink-0 all the way down: this sits next to a truncating title in a flex
        // row, and without it the row squeezes the badges until their labels wrap
        // mid-word ("HD R"). Fixed height + leading-none centers the glyphs; uppercase
        // + wide tracking is what makes a two-letter tag read as a tag.
        <span className="inline-flex shrink-0 items-center gap-1.5">
            {
                resolution !== null ?
                    <span className={BADGE}>{resolution}</span>
                    :
                    null
            }
            {
                quality.hdr ?
                    <span className={BADGE}>HDR</span>
                    :
                    null
            }
            {
                quality.flags.length > 0 ?
                    <span className="shrink-0 whitespace-nowrap text-[0.6875rem] font-medium tracking-wide text-fg-subtle">{quality.flags.slice(0, 4).join(' ')}</span>
                    :
                    null
            }
        </span>
    );
};

// Best-effort infoHash -> library deep links, mined from continue watching
// once per mount: each item there carries the exact stream it was played with,
// encoded (base64 of zlib JSON) as the first segment of deepLinks.player. That
// encoded stream is the only client-side bridge from a torrent infoHash back
// to a meta id. We keep both the MetaDetails link (the "more info" button) and
// the FULL player link (stream + transport urls + type/id/videoId), so playing
// from here restores the title's loading screen and records library progress.
// Cached torrents never played from a library title simply get neither.
type LibraryLinks = {
    metaLink: string | null,
    playerLink: string,
    // Mined alongside the links for the download hero: the clean library title
    // (the entry name is a scene-tagged FILENAME) and the meta id, which for
    // IMDb ids resolves artwork (backdrop + title logo) via metahub - the same
    // CDN the rest of the catalog UI already loads art from.
    itemName: string | null,
    metaId: string | null,
};

// metahub artwork for an IMDb id; other id spaces (kitsu etc.) have no CDN
// here and fall back to the text title / plain gradient.
const metahubBackground = (metaId: string | null): string | null =>
    metaId !== null && /^tt\d+$/.test(metaId) ? `https://images.metahub.space/background/medium/${metaId}/img` : null;
const metahubLogo = (metaId: string | null): string | null =>
    metaId !== null && /^tt\d+$/.test(metaId) ? `https://images.metahub.space/logo/medium/${metaId}/img` : null;

const useLibraryLinksByInfoHash = (): Record<string, LibraryLinks> => {
    const core = useCore();
    const [links, setLinks] = useState<Record<string, LibraryLinks>>({});
    useEffect(() => {
        let cancelled = false;
        core.transport.getState('continue_watching_preview')
            .then(async (state) => {
                const { items } = state as {
                    items?: {
                        deepLinks?: {
                            player?: string | null,
                            metaDetailsStreams?: string | null,
                            metaDetailsVideos?: string | null,
                        },
                    }[],
                };
                const pairs = await Promise.all((items ?? []).map(async (item) => {
                    const playerLink = item.deepLinks?.player;
                    const metaLink = item.deepLinks?.metaDetailsStreams ?? item.deepLinks?.metaDetailsVideos;
                    if (typeof playerLink !== 'string') return null;
                    // '#/player/{encodedStream}/...' - segment 2 of the path is the stream.
                    const encoded = toPath(playerLink).split('/')[2];
                    if (typeof encoded !== 'string' || encoded.length === 0) return null;
                    const stream = await core.transport.decodeStream(decodeURIComponent(encoded)) as Stream | null;
                    // '/metadetails/{type}/{id}/...' - segment 3 is the meta id.
                    const rawId = typeof metaLink === 'string' ? toPath(metaLink).split('/')[3] : undefined;
                    const itemName = (item as { name?: unknown }).name;
                    return stream !== null && typeof stream.infoHash === 'string' ?
                        [stream.infoHash, {
                            metaLink: typeof metaLink === 'string' ? metaLink : null,
                            playerLink,
                            itemName: typeof itemName === 'string' ? itemName : null,
                            metaId: typeof rawId === 'string' && rawId.length > 0 ? decodeURIComponent(rawId) : null,
                        }] as [string, LibraryLinks]
                        :
                        null;
                }));
                if (!cancelled) {
                    setLinks(pairs.reduce<Record<string, LibraryLinks>>((result, pair) => {
                        if (pair !== null) result[pair[0]] = pair[1];
                        return result;
                    }, {}));
                }
            })
            .catch((error) => console.error('Cached: mapping torrents to library items failed', error));
        return () => { cancelled = true; };
    }, []);
    return links;
};

// The server-side streaming-mode toggle (auto-clean watched streams), read
// once per mount and posted optimistically on change. `null` while unknown
// (loading, or no reachable server) - the switch hides and the copy stays
// neutral rather than claiming a state we have not confirmed.
const useStreamingModeSetting = () => {
    const profile = useProfile();
    const serverUrl = profile.settings.streamingServerUrl;
    const [enabled, setEnabled] = useState<boolean | null>(null);
    useEffect(() => {
        if (typeof serverUrl !== 'string') return;
        let cancelled = false;
        fetchStreamingModeEnabled(serverUrl)
            .then((value) => { if (!cancelled) setEnabled(value); })
            .catch(() => { /* stays null: no switch, neutral copy */ });
        return () => { cancelled = true; };
    }, [serverUrl]);
    const toggle = useCallback((next: boolean) => {
        if (typeof serverUrl !== 'string') return;
        setEnabled(next);
        postStreamingModeEnabled(serverUrl, next)
            .catch((error) => {
                console.error('Cached: persisting streaming mode failed', error);
                setEnabled(!next);
            });
    }, [serverUrl]);
    return { enabled, toggle };
};

// Speed telemetry for the hero: samples the byte delta between cache polls
// (~3s apart). A poll that brings no new bytes records an honest 0 so the
// chart shows stalls instead of freezing on the last good bar.
const HISTORY_LENGTH = 48;
const useSpeedHistory = (entry: CacheEntry | null) => {
    const [speeds, setSpeeds] = useState<number[]>([]);
    const peakRef = useRef(0);
    const lastRef = useRef<{ hash: string, t: number, bytes: number } | null>(null);
    useEffect(() => {
        if (entry === null) {
            lastRef.current = null;
            peakRef.current = 0;
            setSpeeds([]);
            return;
        }
        const now = performance.now();
        const last = lastRef.current;
        if (last === null || last.hash !== entry.infoHash) {
            lastRef.current = { hash: entry.infoHash, t: now, bytes: entry.downloaded };
            peakRef.current = 0;
            setSpeeds([]);
            return;
        }
        const dt = (now - last.t) / 1000;
        // The poll interval is 3s; anything much faster is a state echo (a
        // mutation re-poll), not a fresh sample worth charting.
        if (dt < 1) return;
        const speed = Math.max(0, (entry.downloaded - last.bytes) / dt);
        lastRef.current = { hash: entry.infoHash, t: now, bytes: entry.downloaded };
        peakRef.current = Math.max(peakRef.current, speed);
        setSpeeds((h) => [...h, speed].slice(-HISTORY_LENGTH));
    }, [entry]);
    return { speeds, peak: peakRef.current, speed: speeds.length > 0 ? speeds[speeds.length - 1] : 0 };
};

const formatSpeed = (bytesPerSec: number): string => `${formatBytes(bytesPerSec)}/s`;

const formatEta = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '-';
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

// Over-artwork glass (white-alpha family: these sit on the backdrop image, not
// on a panel, so the house surface tokens would read muddy here).
const GLASS_BTN = 'h-9 shrink-0 rounded-full border border-white/15 bg-white/10 px-4 text-[0.8rem] font-medium text-white backdrop-blur-md transition hover:bg-white/20';

/**
 * The download hero: the active download presented like a title, not a row -
 * backdrop artwork under a gradient, the title logo (or clean name), the
 * slot-machine percentage, a live speed chart and glass stats. The layout is
 * hydralauncher/hydra's downloads hero (MIT) rebuilt on the house tokens, with
 * metahub artwork standing in for their game art.
 */
const HeroDownload = ({ entry, links, streamingMode, onPlay, onMoreInfo, onSetPaused, onSetPinned, onDelete }: {
    entry: CacheEntry,
    links: LibraryLinks | undefined,
    streamingMode: boolean | null,
    onPlay: (entry: CacheEntry) => void,
    onMoreInfo: (link: string) => void,
    onSetPaused: (infoHash: string, paused: boolean) => void,
    onSetPinned: (infoHash: string, pinned: boolean) => void,
    onDelete: (infoHash: string) => void,
}) => {
    const { speeds, peak, speed } = useSpeedHistory(entry);
    const paused = entry.state === 'paused';
    const progress = entry.total > 0 ? Math.min(1, entry.downloaded / entry.total) : 0;
    const pct = Math.floor(progress * 100);
    const etaSeconds = speed > 0 ? (entry.total - entry.downloaded) / speed : NaN;

    const metaId = links?.metaId ?? null;
    const title = links?.itemName ?? entry.name;
    const backgroundUrl = metahubBackground(metaId);
    const logoUrl = metahubLogo(metaId);
    const [backgroundFailed, setBackgroundFailed] = useState(false);
    const [logoFailed, setLogoFailed] = useState(false);
    useEffect(() => { setBackgroundFailed(false); setLogoFailed(false); }, [metaId]);

    return (
        <div className="relative overflow-hidden">
            {
                backgroundUrl !== null && !backgroundFailed ?
                    <img
                        src={backgroundUrl}
                        alt=""
                        onError={() => setBackgroundFailed(true)}
                        className="absolute inset-0 size-full object-cover object-[50%_20%]"
                    />
                    :
                    null
            }
            {/* Melts the artwork into the list below; also carries the whole hero
                when there is no artwork (non-IMDb ids). */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-bg/80 to-bg" />

            <div className="relative flex flex-col gap-4 px-6 pb-5 pt-6">
                <div className="flex min-h-14 items-center">
                    {
                        logoUrl !== null && !logoFailed ?
                            <img
                                src={logoUrl}
                                alt={title}
                                onError={() => setLogoFailed(true)}
                                className="max-h-16 max-w-[55%] object-contain object-left drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]"
                            />
                            :
                            <div className="flex min-w-0 items-center gap-2.5">
                                <div className="truncate text-2xl font-bold text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.9)]" title={title}>{title}</div>
                                <QualityBadges name={entry.name} />
                            </div>
                    }
                </div>

                <div className="flex items-end justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-white/70">
                            {paused ? 'Paused' : 'Downloading'}
                        </div>
                        <div className="text-[1.9rem] font-bold leading-none tracking-[-0.02em] text-white">
                            <AnimatedPercentage text={`${pct}%`} />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {
                            // Keep only matters while auto-clean can delete things;
                            // with streaming mode off nothing is ever cleaned up, so
                            // the control would be a no-op and reads as noise.
                            streamingMode === true ?
                                <Button
                                    variant="ghost"
                                    className={cn(GLASS_BTN, entry.pinned && 'border-accent/40 bg-accent/20 text-accent')}
                                    onClick={() => onSetPinned(entry.infoHash, !entry.pinned)}
                                    title={entry.pinned ? 'Kept: never cleaned up automatically. Click to allow cleanup' : 'Keep this title in the cache (never cleaned up automatically)'}
                                >
                                    {entry.pinned ? 'Kept' : 'Keep'}
                                </Button>
                                :
                                null
                        }
                        <Button variant="ghost" className={GLASS_BTN} onClick={() => onSetPaused(entry.infoHash, !paused)} title={paused ? 'Resume this download' : 'Pause this download'}>
                            {paused ? 'Resume' : 'Pause'}
                        </Button>
                        {
                            typeof entry.fileIdx === 'number' ?
                                <IconButton onClick={() => onPlay(entry)} title="Play" className="size-9 text-accent hover:brightness-110">
                                    <Play className="size-5" />
                                </IconButton>
                                :
                                null
                        }
                        {
                            typeof links?.metaLink === 'string' ?
                                <IconButton onClick={() => onMoreInfo(links.metaLink as string)} title="More info" className="size-9 text-white/70 hover:text-white">
                                    <Info className="size-5" />
                                </IconButton>
                                :
                                null
                        }
                        <IconButton onClick={() => onDelete(entry.infoHash)} title="Delete from cache (frees disk space; can be re-downloaded)" className="size-9 text-white/70 hover:text-danger">
                            <Trash2 className="size-5" />
                        </IconButton>
                    </div>
                </div>

                <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>

                <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                    <SpeedChart speeds={speeds} peakSpeed={peak} height={48} />
                    <div className="flex items-baseline justify-between text-[0.8rem] tabular-nums">
                        <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-white/50">Speed</span>
                        <span className="font-semibold text-white/90">{formatSpeed(speed)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-[0.8rem] tabular-nums">
                        <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-white/50">Downloaded</span>
                        <span className="font-semibold text-white/90">
                            {formatBytes(entry.downloaded)}
                            <span className="text-white/45">{` / ${formatBytes(entry.total)}`}</span>
                        </span>
                    </div>
                    <div className="flex items-baseline justify-between text-[0.8rem] tabular-nums">
                        <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-white/50">Time left</span>
                        <span className="font-semibold text-white/90">{paused ? '-' : formatEta(etaSeconds)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Row = ({ entry, metaLink, streamingMode, onPlay, onMoreInfo, onSetPaused, onSetPinned, onDelete }: {
    entry: CacheEntry,
    metaLink: string | null,
    streamingMode: boolean | null,
    onPlay: (entry: CacheEntry) => void,
    onMoreInfo: (link: string) => void,
    onSetPaused: (infoHash: string, paused: boolean) => void,
    onSetPinned: (infoHash: string, pinned: boolean) => void,
    onDelete: (infoHash: string) => void,
}) => {
    const progress = entry.total > 0 ? Math.min(1, entry.downloaded / entry.total) : 0;
    const complete = entry.total > 0 && entry.downloaded >= entry.total;
    const paused = entry.state === 'paused';
    // While initializing there is no have-byte count to show: librqbit has not
    // built the chunk tracker yet, and its torrent-level counter means the HASH
    // CHECK's scan there, not data we hold. Showing "0 KB / 9.29 GB" next to a
    // half-downloaded file reads as lost progress, and a progress bar at 0% says
    // the same thing louder. Show the size alone until the real count exists.
    const preparing = entry.state === 'initializing';
    // Pause/resume only makes sense mid-download: live-and-incomplete or paused.
    // NOT while initializing - librqbit hard-refuses that ("torrent is
    // initializing, can't pause"), so offering the button only produced a pause
    // that reported success and did nothing. Delete still works there.
    const pausable = !complete && (entry.state === 'live' || paused);
    return (
        <div className="group flex items-center gap-4 px-6 py-4 transition hover:bg-white/5">
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2.5">
                    <div className="truncate text-sm font-medium text-fg" title={entry.name}>
                        {entry.name || entry.infoHash}
                    </div>
                    <QualityBadges name={entry.name} />
                </div>
                {/* danger, not warning: this row FAILED, it is not a caution. The rest
                    of the app already draws that line (warning = the slow-source and
                    oversized-library notices; danger = every error and every
                    destructive control), and this file was the last holdout. */}
                <div className={cn('mt-1 text-xs tabular-nums', entry.state === 'error' ? 'text-danger' : 'text-fg-muted')}>
                    {
                        complete ?
                            formatBytes(entry.downloaded)
                            :
                            preparing ?
                                (entry.total > 0 ? formatBytes(entry.total) : null)
                                :
                                <>
                                    {formatBytes(entry.downloaded)}
                                    {entry.total > 0 ? <span className="text-fg-subtle">{` / ${formatBytes(entry.total)}`}</span> : null}
                                </>
                    }
                    <span className="text-fg-subtle">{' · '}</span>
                    {stateLabel(entry)}
                    {
                        // Only for a genuine pack. A movie shipping a .nfo beside it
                        // resolves to one playable video, and calling that "2 files"
                        // read as "this is a season pack" when it is not.
                        entry.fileCount > 1 && typeof entry.fileIdx !== 'number' ?
                            <><span className="text-fg-subtle">{' · '}</span>{`${entry.fileCount} files`}</>
                            :
                            null
                    }
                    {
                        // Honest about the pending cleanup: with streaming mode on, a
                        // watched un-kept stream is on the sweeper's list.
                        streamingMode === true && entry.watched && !entry.pinned ?
                            <><span className="text-fg-subtle">{' · '}</span>Watched, cleans up soon</>
                            :
                            null
                    }
                </div>
                {
                    !complete && !preparing && entry.total > 0 ?
                        <div className="mt-2.5 h-0.5 w-full overflow-hidden rounded-full bg-surface">
                            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
                        </div>
                        :
                        null
                }
            </div>
            {/* Same labeled-pill treatment as Pause. Kept state stays visible
                (it is standing information, not just an action); the un-kept
                affordance appears on hover like Info/Delete. Hidden entirely
                while auto-clean is off: nothing deletes, so Keep is a no-op. */}
            {
                streamingMode === true ?
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSetPinned(entry.infoHash, !entry.pinned)}
                        title={entry.pinned ? 'Kept: never cleaned up automatically. Click to allow cleanup' : 'Keep this title in the cache (never cleaned up automatically)'}
                        className={cn(
                            'shrink-0 bg-surface px-3.5',
                            entry.pinned ?
                                'border-accent/40 text-accent opacity-100 hover:brightness-110'
                                :
                                'text-fg-muted opacity-0 hover:text-fg group-hover:opacity-100',
                        )}
                    >
                        {entry.pinned ? 'Kept' : 'Keep'}
                    </Button>
                    :
                    null
            }
            {
                // A labeled pill (not an icon): a pause/resume TRIANGLE would be
                // confusable with the media Play button, and inline status text
                // did not read as clickable. Always visible while transferring.
                pausable ?
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSetPaused(entry.infoHash, !paused)}
                        title={paused ? 'Resume this download' : 'Pause this download'}
                        className="shrink-0 bg-surface px-3.5 text-fg-muted hover:text-fg"
                    >
                        {paused ? 'Resume' : 'Pause'}
                    </Button>
                    :
                    null
            }
            {
                typeof entry.fileIdx === 'number' ?
                    <IconButton
                        onClick={() => onPlay(entry)}
                        title="Play"
                        className="size-9 text-accent opacity-100 hover:brightness-110"
                    >
                        <Play className="size-5" />
                    </IconButton>
                    :
                    null
            }
            {
                typeof metaLink === 'string' ?
                    <IconButton
                        onClick={() => onMoreInfo(metaLink)}
                        title="More info"
                        className="size-9 text-fg-muted opacity-0 hover:text-fg group-hover:opacity-100"
                    >
                        <Info className="size-5" />
                    </IconButton>
                    :
                    null
            }
            <IconButton
                onClick={() => onDelete(entry.infoHash)}
                title="Delete from cache (frees disk space; can be re-downloaded)"
                className="size-9 text-fg-muted opacity-0 hover:text-danger group-hover:opacity-100"
            >
                <Trash2 className="size-5" />
            </IconButton>
        </div>
    );
};

// The Cached page: everything the streaming engine holds on disk, with live
// download progress, pin (eviction protection) and delete. The user's window
// into "what is eating my disk" - and the place the disk-full error can send
// them to free space.
type Props = {
    onClose: () => void,
};

const Cached = ({ onClose }: Props) => {
    const closeCached = onClose;
    const navigate = useNavigate();
    const core = useCore();
    const { entries, failed, setPinned, setPaused, remove } = useCachedTorrents();
    const libraryLinks = useLibraryLinksByInfoHash();
    const streamingMode = useStreamingModeSetting();

    // Prefer the FULL player deep link mined from continue watching (stream +
    // transport urls + type/id/videoId): it restores the title logo on the
    // loading screen and records progress into the library. When the torrent
    // is unknown to the library, fall back to a stream-only link: the core
    // encodes the stream (base64 of zlib JSON) and the /player/:stream route
    // decodes it back, loading the torrent through the local streaming server.
    // Navigating to a real route (player / metadetails) from inside the modal
    // closes the modal via the bus first, then navigates.
    const play = useCallback((entry: CacheEntry) => {
        const playerLink = libraryLinks[entry.infoHash]?.playerLink;
        if (typeof playerLink === 'string') {
            closeCached();
            navigate(toPath(playerLink));
            return;
        }
        core.transport.encodeStream({
            name: entry.name,
            description: '',
            infoHash: entry.infoHash,
            fileIdx: entry.fileIdx,
        })
            .then((encoded) => {
                if (typeof encoded === 'string') {
                    closeCached();
                    navigate(`/player/${encodeURIComponent(encoded)}`);
                } else {
                    console.error('Cached: the core could not encode a stream for', entry.infoHash);
                }
            })
            .catch((error) => console.error('Cached: encoding the stream failed', error));
    }, [navigate, libraryLinks, closeCached]);

    const openMetaDetails = useCallback((link: string) => {
        closeCached();
        navigate(toPath(link));
    }, [navigate, closeCached]);

    const totalBytes = useMemo(
        () => (entries ?? []).reduce((sum, entry) => sum + entry.downloaded, 0),
        [entries],
    );

    // The hero: the first ACTIVE download (live or paused mid-transfer - paused
    // stays a hero so pausing does not bounce the layout). Initializing entries
    // have no honest byte counts yet and errors are rows, not heroes.
    const heroEntry = useMemo(
        () => (entries ?? []).find((entry) =>
            entry.total > 0 && entry.downloaded < entry.total &&
            (entry.state === 'live' || entry.state === 'paused')) ?? null,
        [entries],
    );

    return (
        <ModalRoute
            open
            onClose={closeCached}
            title="Cache"
            hideHeader
            showClose={false}
            className="flex h-[min(42rem,calc(100vh-6rem))] w-[min(52rem,calc(100vw-4rem))] max-w-[min(52rem,calc(100vw-4rem))] flex-col gap-0 overflow-hidden border border-line p-0"
        >
            <div className="flex items-start gap-3 px-6 pb-3 pt-5">
                <div className="min-w-0">
                    <div className="flex items-baseline gap-3">
                        <h1 className="text-xl font-semibold text-fg">Cache</h1>
                        {
                            entries !== null && entries.length > 0 ?
                                <div className="text-sm tabular-nums text-fg-muted">{formatBytes(totalBytes)} on disk</div>
                                :
                                null
                        }
                    </div>
                    <div className="mt-1 text-xs text-fg-subtle">
                        {
                            streamingMode.enabled === true ?
                                'Streams are cleaned up a while after you watch them. Kept titles stay until you delete them.'
                                :
                                'Everything the player keeps on disk. Nothing is deleted automatically.'
                        }
                    </div>
                </div>
                {
                    // Streaming mode lives right where its effect is visible. Hidden
                    // until the server confirms a state (no reachable server = no
                    // switch to flip into the void).
                    streamingMode.enabled !== null ?
                        <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2.5 pt-1">
                            <span className="text-xs font-medium text-fg-muted">Auto-clean watched</span>
                            <Switch
                                checked={streamingMode.enabled}
                                onCheckedChange={streamingMode.toggle}
                            />
                        </label>
                        :
                        null
                }
                <IconButton
                    onClick={closeCached}
                    title="Close"
                    className={cn('size-9 text-fg-muted', streamingMode.enabled === null && 'ml-auto')}
                >
                    <X className="size-5" />
                </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {
                    failed ?
                        <div className="px-5 py-10 text-center text-sm text-fg-muted">
                            The streaming service is not reachable.
                        </div>
                        :
                        entries === null ?
                            <div className="px-5 py-10 text-center text-sm text-fg-muted">Loading…</div>
                            :
                            entries.length === 0 ?
                                <div className="px-5 py-10 text-center text-sm text-fg-muted">
                                    Nothing cached yet. Streams are kept here while you watch, and the Download button on any source stores it for later.
                                </div>
                                :
                                <>
                                    {
                                        heroEntry !== null ?
                                            <HeroDownload
                                                entry={heroEntry}
                                                links={libraryLinks[heroEntry.infoHash]}
                                                streamingMode={streamingMode.enabled}
                                                onPlay={play}
                                                onMoreInfo={openMetaDetails}
                                                onSetPaused={setPaused}
                                                onSetPinned={setPinned}
                                                onDelete={remove}
                                            />
                                            :
                                            null
                                    }
                                    <div className="divide-y divide-surface">
                                        {entries.filter((entry) => entry.infoHash !== heroEntry?.infoHash).map((entry) => (
                                            <Row
                                                key={entry.infoHash}
                                                entry={entry}
                                                metaLink={libraryLinks[entry.infoHash]?.metaLink ?? null}
                                                streamingMode={streamingMode.enabled}
                                                onPlay={play}
                                                onMoreInfo={openMetaDetails}
                                                onSetPaused={setPaused}
                                                onSetPinned={setPinned}
                                                onDelete={remove}
                                            />
                                        ))}
                                    </div>
                                </>
                }
            </div>
        </ModalRoute>
    );
};

export default Cached;
