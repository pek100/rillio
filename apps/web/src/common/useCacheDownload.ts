// Copyright (C) 2017-2024 Smart code 203358507

import * as React from 'react';
import useProfile from 'rillio/common/useProfile';
import useToast from 'rillio/common/Toast/useToast';
import { notifyCacheChanged } from 'rillio/common/cacheEvents';

// "Download to cache": ask the local streaming server to fetch a torrent
// stream in the background and PIN it (the cache sweeper never evicts pinned
// torrents) - watch-later without having to stream it now. Returns a callback
// that accepts a stream-like object ({ infoHash, fileIdx? }) and reports
// whether it could act on it (false = not a torrent stream / no server).
const useCacheDownload = () => {
    const profile = useProfile();
    const toast = useToast();
    return React.useCallback((stream: any): boolean => {
        const serverUrl = profile.settings.streamingServerUrl;
        if (!stream || typeof stream.infoHash !== 'string' || typeof serverUrl !== 'string') {
            // FAIL LOUD. This used to return false in silence, so a caller handed an
            // undownloadable stream (or a missing server url) produced no request, no
            // cache entry and no explanation - indistinguishable from a dead button.
            console.error('cache/download: not a downloadable torrent stream', { stream, serverUrl });
            toast.show({
                type: 'error',
                title: 'Cannot download this stream',
                message: typeof serverUrl !== 'string' ?
                    'The streaming service is not configured.'
                    :
                    'This source is not a torrent.',
                timeout: 4000,
            });
            return false;
        }
        const body: { infoHash: string; fileIdx?: number } = { infoHash: stream.infoHash };
        if (typeof stream.fileIdx === 'number') {
            body.fileIdx = stream.fileIdx;
        }
        fetch(new URL('cache/download', serverUrl), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then((resp) => {
                if (!resp.ok) {
                    throw new Error(`cache/download responded ${resp.status}`);
                }
                toast.show({
                    type: 'success',
                    title: 'Downloading to cache',
                    message: 'Track progress on the Cached page.',
                    timeout: 4000,
                });
                // A new download is live: light the top-nav dot now rather than on
                // that hook's next lazy tick.
                notifyCacheChanged();
            })
            .catch((error) => {
                console.error('cache/download failed', error);
                toast.show({
                    type: 'error',
                    title: 'Download failed to start',
                    message: 'The streaming service is not reachable.',
                    timeout: 4000,
                });
            });
        return true;
    }, [profile.settings.streamingServerUrl]);
};

export = useCacheDownload;
