import { useEffect, useState } from 'react';

// Direct module require, NOT the 'rillio/common' barrel: this hook loads with
// TopNav at app startup, before the barrel's circular imports resolve, and the
// barrel's useProfile is still undefined at that point (crashes the app).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const useProfile = require('rillio/common/useProfile');

// True while the local streaming server is actively downloading anything
// (a cache entry that is live and incomplete). Backs the top-nav Cached
// button's pulsing dot. Polls lazily (10s) because it runs app-wide, and
// fails quiet: an unreachable server just means no indicator.
const POLL_INTERVAL_MS = 10000;

type ListEntry = { state: string, downloaded: number, total: number };

const useActiveDownloads = (): boolean => {
    const profile = useProfile();
    const serverUrl = profile.settings.streamingServerUrl;
    const [active, setActive] = useState(false);

    useEffect(() => {
        if (typeof serverUrl !== 'string') {
            setActive(false);
            return;
        }
        let cancelled = false;
        const poll = () => {
            fetch(new URL('cache/list', serverUrl))
                .then((resp) => resp.json())
                .then((list: ListEntry[]) => {
                    if (cancelled) return;
                    // 'initializing' (post-restart hash check) counts as active:
                    // the engine is visibly working toward an incomplete download.
                    setActive(Array.isArray(list) && list.some((entry) =>
                        (entry.state === 'live' || entry.state === 'initializing') && entry.downloaded < entry.total
                    ));
                })
                .catch(() => {
                    if (!cancelled) setActive(false);
                });
        };
        poll();
        const interval = setInterval(poll, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [serverUrl]);

    return active;
};

export default useActiveDownloads;
