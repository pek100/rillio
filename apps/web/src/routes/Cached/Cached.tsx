import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Info, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toPath } from 'rillio-router';
import { useCore } from 'rillio/core';
import { Button, IconButton, ModalRoute, cn } from 'rillio/components/ui';
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
};

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
                    return stream !== null && typeof stream.infoHash === 'string' ?
                        [stream.infoHash, {
                            metaLink: typeof metaLink === 'string' ? metaLink : null,
                            playerLink,
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

const Row = ({ entry, metaLink, onPlay, onMoreInfo, onSetPaused, onDelete }: {
    entry: CacheEntry,
    metaLink: string | null,
    onPlay: (entry: CacheEntry) => void,
    onMoreInfo: (link: string) => void,
    onSetPaused: (infoHash: string, paused: boolean) => void,
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
                    {entry.fileCount > 1 ? <><span className="text-fg-subtle">{' · '}</span>{`${entry.fileCount} files`}</> : null}
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
    const { entries, failed, setPaused, remove } = useCachedTorrents();
    const libraryLinks = useLibraryLinksByInfoHash();

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

    return (
        <ModalRoute
            open
            onClose={closeCached}
            title="Cached"
            hideHeader
            showClose={false}
            className="flex h-[min(42rem,calc(100vh-6rem))] w-[min(52rem,calc(100vw-4rem))] max-w-[min(52rem,calc(100vw-4rem))] flex-col gap-0 overflow-hidden border border-line p-0"
        >
            <div className="flex items-start gap-3 px-6 pb-3 pt-5">
                <div className="min-w-0">
                    <div className="flex items-baseline gap-3">
                        <h1 className="text-xl font-semibold text-fg">Cached</h1>
                        {
                            entries !== null && entries.length > 0 ?
                                <div className="text-sm tabular-nums text-fg-muted">{formatBytes(totalBytes)} on disk</div>
                                :
                                null
                        }
                    </div>
                    <div className="mt-1 text-xs text-fg-subtle">
                        Everything the player keeps on disk. Nothing is deleted automatically.
                    </div>
                </div>
                <IconButton
                    onClick={closeCached}
                    title="Close"
                    className="ml-auto size-9 text-fg-muted"
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
                                <div className="divide-y divide-surface">
                                    {entries.map((entry) => (
                                        <Row
                                            key={entry.infoHash}
                                            entry={entry}
                                            metaLink={libraryLinks[entry.infoHash]?.metaLink ?? null}
                                            onPlay={play}
                                            onMoreInfo={openMetaDetails}
                                            onSetPaused={setPaused}
                                            onDelete={remove}
                                        />
                                    ))}
                                </div>
                }
            </div>
        </ModalRoute>
    );
};

export default Cached;
