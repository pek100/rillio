import { useCallback, useEffect, useRef, useState } from 'react';
import { useProfile } from 'rillio/common';
import useToast from 'rillio/common/Toast/useToast';

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
    const toast = useToast();
    const serverUrl = profile.settings.streamingServerUrl;
    const [entries, setEntries] = useState<CacheEntry[] | null>(null);
    const [failed, setFailed] = useState(false);
    // Deleted rows disappear immediately (the next poll confirms), so the UI
    // never shows a "deleted" item bouncing back for a second.
    const hidden = useRef<Set<string>>(new Set());
    // Bumped by every mutation. The poll below runs on its own 3s timer, so a
    // request issued BEFORE a mutation can land AFTER it, carrying a snapshot
    // that predates the change - applying it would flip the row straight back
    // (this is what made Pause look like it "sometimes does not work": the
    // optimistic 'paused' got clobbered by an in-flight poll's 'live', and the
    // second click then un-paused). A response is only applied if no mutation
    // happened while it was in flight.
    const mutationSeq = useRef(0);

    const refresh = useCallback(() => {
        if (typeof serverUrl !== 'string') return;
        const seq = mutationSeq.current;
        fetch(new URL('cache/list', serverUrl))
            .then((resp) => {
                if (!resp.ok) throw new Error(`cache/list responded ${resp.status}`);
                return resp.json();
            })
            .then((list: CacheEntry[]) => {
                if (seq !== mutationSeq.current) return;
                setEntries(list.filter((entry) => !hidden.current.has(entry.infoHash)));
                setFailed(false);
            })
            .catch(() => {
                if (seq !== mutationSeq.current) return;
                setFailed(true);
            });
    }, [serverUrl]);

    // Mutations are POSTs that the server only acknowledges after the engine has
    // actually applied them, so re-polling once the POST settles converges the row
    // immediately instead of leaving the optimistic guess up for the next 3s tick.
    // A non-2xx is a real failure (an unknown infoHash is a 404) and must not read
    // as success: say so and re-poll to show the true state, never a silent revert.
    const mutate = useCallback((path: string, body: unknown, failureTitle: string, onFailure?: () => void) => {
        mutationSeq.current += 1;
        return fetch(new URL(path, serverUrl as string), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then((resp) => {
                if (!resp.ok) throw new Error(`${path} responded ${resp.status}`);
            })
            .catch((error) => {
                console.error(`useCachedTorrents: ${path} failed`, error);
                toast.show({ type: 'error', title: failureTitle, message: 'The streaming service did not accept the change.' });
                // Runs BEFORE the refresh below, so an undo (un-hiding a row whose
                // delete failed) is already in place when the fresh list is applied.
                if (onFailure !== undefined) onFailure();
            })
            .then(() => refresh());
    }, [serverUrl, refresh, toast]);

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
        mutate('cache/pin', { infoHash, pinned }, pinned ? 'Could not pin this download' : 'Could not unpin this download');
    }, [serverUrl, mutate]);

    const setPaused = useCallback((infoHash: string, paused: boolean) => {
        if (typeof serverUrl !== 'string') return;
        setEntries((current) => current !== null ?
            current.map((entry) => entry.infoHash === infoHash ? { ...entry, state: paused ? 'paused' : 'live' } : entry)
            :
            current
        );
        mutate('cache/pause', { infoHash, paused }, paused ? 'Could not pause this download' : 'Could not resume this download');
    }, [serverUrl, mutate]);

    const remove = useCallback((infoHash: string) => {
        if (typeof serverUrl !== 'string') return;
        hidden.current.add(infoHash);
        setEntries((current) => current !== null ?
            current.filter((entry) => entry.infoHash !== infoHash)
            :
            current
        );
        mutate('cache/delete', { infoHash }, 'Could not delete this download', () => {
            hidden.current.delete(infoHash);
        });
    }, [serverUrl, mutate]);

    return { entries, failed, setPinned, setPaused, remove };
};

export default useCachedTorrents;
