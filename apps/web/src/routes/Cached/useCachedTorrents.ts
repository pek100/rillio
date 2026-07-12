import { useCallback, useEffect, useRef, useState } from 'react';
import { useProfile } from 'rillio/common';

export type CacheEntry = {
    infoHash: string,
    name: string,
    downloaded: number,
    total: number,
    state: string,
    error?: string,
    pinned: boolean,
    fileCount: number,
    // The single selected file's index when the entry is one playable file,
    // absent for multi-file selections. Powers the row's play button.
    fileIdx?: number,
};

// The Cached page's data layer: polls the local streaming server's cache list
// while mounted (downloads progress live), and exposes pin/delete mutations.
// Talks to the server directly (same as the media player does) because the
// cache is a server-side concept the core model doesn't know about.
const useCachedTorrents = () => {
    const profile = useProfile();
    const serverUrl = profile.settings.streamingServerUrl;
    const [entries, setEntries] = useState<CacheEntry[] | null>(null);
    const [failed, setFailed] = useState(false);
    // Deleted rows disappear immediately (the next poll confirms), so the UI
    // never shows a "deleted" item bouncing back for a second.
    const hidden = useRef<Set<string>>(new Set());

    const refresh = useCallback(() => {
        if (typeof serverUrl !== 'string') return;
        fetch(new URL('cache/list', serverUrl))
            .then((resp) => resp.json())
            .then((list: CacheEntry[]) => {
                setEntries(list.filter((entry) => !hidden.current.has(entry.infoHash)));
                setFailed(false);
            })
            .catch(() => setFailed(true));
    }, [serverUrl]);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 3000);
        return () => clearInterval(interval);
    }, [refresh]);

    const setPinned = useCallback((infoHash: string, pinned: boolean) => {
        if (typeof serverUrl !== 'string') return;
        setEntries((current) => current !== null ?
            current.map((entry) => entry.infoHash === infoHash ? { ...entry, pinned } : entry)
            :
            current
        );
        fetch(new URL('cache/pin', serverUrl), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ infoHash, pinned }),
        }).catch(() => refresh());
    }, [serverUrl, refresh]);

    const setPaused = useCallback((infoHash: string, paused: boolean) => {
        if (typeof serverUrl !== 'string') return;
        setEntries((current) => current !== null ?
            current.map((entry) => entry.infoHash === infoHash ? { ...entry, state: paused ? 'paused' : 'live' } : entry)
            :
            current
        );
        fetch(new URL('cache/pause', serverUrl), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ infoHash, paused }),
        }).catch(() => refresh());
    }, [serverUrl, refresh]);

    const remove = useCallback((infoHash: string) => {
        if (typeof serverUrl !== 'string') return;
        hidden.current.add(infoHash);
        setEntries((current) => current !== null ?
            current.filter((entry) => entry.infoHash !== infoHash)
            :
            current
        );
        fetch(new URL('cache/delete', serverUrl), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ infoHash }),
        }).catch(() => {
            hidden.current.delete(infoHash);
            refresh();
        });
    }, [serverUrl, refresh]);

    return { entries, failed, setPinned, setPaused, remove };
};

export default useCachedTorrents;
