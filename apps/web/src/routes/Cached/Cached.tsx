import React, { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import Icon from '@stremio/stremio-icons/react';
import { useNavigate } from 'react-router';
import { toPath, useCloseModalRoute } from 'rillio-router';
import { useCore } from 'rillio/core';
import useCachedTorrents, { CacheEntry } from './useCachedTorrents';
import styles from './styles.less';

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

// Quality badges parsed from the torrent name, mirroring the stream cards.
const QualityBadges = ({ name }: { name: string }) => {
    const quality: ParsedQuality = useMemo(() => parseStream({ name, description: '' }), [name]);
    const resolution = quality.resolution >= 2160 ? '4K' :
        quality.resolution > 0 ? `${quality.resolution}p` : null;
    if (resolution === null && !quality.hdr && quality.flags.length === 0) {
        return null;
    }
    return (
        <span className="inline-flex items-center gap-1.5">
            {
                resolution !== null ?
                    <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">{resolution}</span>
                    :
                    null
            }
            {
                quality.hdr ?
                    <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">HDR</span>
                    :
                    null
            }
            {
                quality.flags.length > 0 ?
                    <span className="text-[11px] tracking-tight">{quality.flags.slice(0, 4).join(' ')}</span>
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
    // Pause/resume only makes sense mid-download: live-and-incomplete or paused.
    // 'initializing' (hash-check after a restart) is also an active transfer
    // the user may want to stop; librqbit accepts pause during it.
    const pausable = !complete && (entry.state === 'live' || entry.state === 'initializing' || paused);
    return (
        <div className="group flex items-center gap-4 px-6 py-4 transition hover:bg-white/5">
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2.5">
                    <div className="truncate text-sm font-medium text-fg" title={entry.name}>
                        {entry.name || entry.infoHash}
                    </div>
                    <QualityBadges name={entry.name} />
                </div>
                <div className={classNames('mt-1 text-xs tabular-nums', entry.state === 'error' ? 'text-warning' : 'text-fg-muted')}>
                    {
                        complete ?
                            formatBytes(entry.downloaded)
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
                    !complete && entry.total > 0 ?
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
                    <button
                        type="button"
                        onClick={() => onSetPaused(entry.infoHash, !paused)}
                        title={paused ? 'Resume this download' : 'Pause this download'}
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface px-3.5 text-xs font-semibold text-fg-muted transition hover:bg-surface-hover hover:text-fg"
                    >
                        {paused ? 'Resume' : 'Pause'}
                    </button>
                    :
                    null
            }
            {
                typeof entry.fileIdx === 'number' ?
                    <button
                        type="button"
                        onClick={() => onPlay(entry)}
                        title="Play"
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-accent transition hover:bg-surface-hover hover:brightness-110"
                    >
                        <Icon name="play" className="size-5" />
                    </button>
                    :
                    null
            }
            {
                typeof metaLink === 'string' ?
                    <button
                        type="button"
                        onClick={() => onMoreInfo(metaLink)}
                        title="More info"
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted opacity-0 transition hover:bg-surface-hover hover:text-fg group-hover:opacity-100"
                    >
                        <Icon name="about" className="size-5" />
                    </button>
                    :
                    null
            }
            <button
                type="button"
                onClick={() => onDelete(entry.infoHash)}
                title="Delete from cache (frees disk space; can be re-downloaded)"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted opacity-0 transition hover:bg-surface-hover hover:text-warning group-hover:opacity-100"
            >
                <Icon name="bin" className="size-5" />
            </button>
        </div>
    );
};

// The Cached page: everything the streaming engine holds on disk, with live
// download progress, pin (eviction protection) and delete. The user's window
// into "what is eating my disk" - and the place the disk-full error can send
// them to free space.
const Cached = () => {
    const closeCached = useCloseModalRoute();
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
    const play = useCallback((entry: CacheEntry) => {
        const playerLink = libraryLinks[entry.infoHash]?.playerLink;
        if (typeof playerLink === 'string') {
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
                    navigate(`/player/${encodeURIComponent(encoded)}`);
                } else {
                    console.error('Cached: the core could not encode a stream for', entry.infoHash);
                }
            })
            .catch((error) => console.error('Cached: encoding the stream failed', error));
    }, [navigate, libraryLinks]);

    const openMetaDetails = useCallback((link: string) => {
        navigate(toPath(link));
    }, [navigate]);

    const totalBytes = useMemo(
        () => (entries ?? []).reduce((sum, entry) => sum + entry.downloaded, 0),
        [entries],
    );

    return (
        <div className={styles['cached-modal']}>
            <div className={styles['backdrop']} onClick={closeCached} />
            <div className={classNames(styles['panel'], 'flex flex-col overflow-hidden')} role="dialog" aria-modal="true" aria-label="Cached">
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
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={closeCached}
                        title="Close"
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted opacity-60 transition hover:bg-surface-hover hover:opacity-100"
                    >
                        <Icon name="close" className="size-5" />
                    </button>
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
            </div>
        </div>
    );
};

export default Cached;
