// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Global bus announcing "the cache changed because WE just changed it".
 *
 * The top-nav download dot (useActiveDownloads) polls the streaming server on a
 * lazy timer because it runs app-wide, so a pause/resume/delete left the dot
 * showing the old answer until the next tick - seconds of a stale indicator
 * after a click the user watched land. Nothing about that is asynchronous from
 * the user's point of view: we issued the mutation, we know it settled.
 *
 * So mutators announce, and pollers re-read at once. Deliberately a bare signal
 * with no payload: subscribers already know how to fetch their own view of the
 * cache (they each read a different shape of it), and the server is loopback, so
 * a re-poll costs nothing and cannot drift from the truth the way a pushed
 * payload could. Server-side changes nobody asked for (a download finishing) are
 * still found by the poll - no client event can know about those.
 *
 * Same "a global bus, not a URL" convention as common/modalEvents.
 */

const listeners = new Set<() => void>();

/** Call once a cache mutation has SETTLED (not when it is issued): the point is
 *  that a re-poll now returns the new truth. */
export const notifyCacheChanged = (): void => {
    listeners.forEach((listener) => listener());
};

export const subscribeCacheChanged = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
