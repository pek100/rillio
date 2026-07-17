// The autosync engine, mounted once in App. Two jobs:
//
// 1. TRANSLATE the core's sync events into the persistent activity log
//    (common/syncActivity) - the log records what the core actually did, not
//    what the UI hoped, so a "successful" no-op push is visible as such.
// 2. SCHEDULE sync while connected: the core auto-pushes every library edit and
//    addon change the moment they happen (update_library.rs / update_profile.rs)
//    but nothing ever PULLS on its own, so this dispatches a full two-way pass
//    (SyncLibraryWithAPI + PullAddonsFromAPI + PullUserFromAPI) on launch, on
//    window focus (throttled), and on an interval.
//
// Session expiry is safe to probe: an expired key now dispatches
// Internal::Disconnect in the core (local data kept), never the wiping Logout.

import { useEffect, useRef } from 'react';
import { useCore } from 'rillio/core';
import { logSync } from 'rillio/common/syncActivity';

const useProfile = require('rillio/common/useProfile');

const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const FOCUS_THROTTLE_MS = 60 * 1000;

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const useStremioSync = () => {
    const core = useCore();
    const profile = useProfile();
    // `!= null` (loose), NOT `!== null`: before the first core state lands,
    // profile.auth is undefined - strict-null gating made the scheduler run for
    // anonymous users (caught by the activity log's own error entries).
    const connected = profile.auth != null;
    const lastRunRef = useRef(0);

    // Event -> activity log. Attached regardless of auth so connect/disconnect
    // themselves are captured too.
    useEffect(() => {
        const onEvent = (name: string, args: any) => {
            switch (name) {
                case 'UserAuthenticated':
                    logSync('connect', 'Connected to Stremio');
                    break;
                case 'SessionDisconnected':
                    logSync('disconnect', 'Disconnected from Stremio - everything stays saved on this device');
                    break;
                case 'UserLoggedOut':
                    logSync('logout', 'Signed out');
                    break;
                case 'LibrarySyncWithAPIPlanned': {
                    const [pullIds, pushIds] = (args && args.plan) || [[], []];
                    if (pullIds.length === 0 && pushIds.length === 0) {
                        logSync('library-plan', 'Library checked - already in sync');
                    } else {
                        logSync('library-plan', `Library sync planned: ${count(pushIds.length, 'item')} to send, ${count(pullIds.length, 'item')} to fetch`);
                    }
                    break;
                }
                case 'LibraryItemsPushedToAPI':
                    logSync('library-push', `Sent ${count(((args && args.ids) || []).length, 'library item')} to the account`);
                    break;
                case 'LibraryItemsPulledFromAPI':
                    logSync('library-pull', `Fetched ${count(((args && args.ids) || []).length, 'library item')} from the account`);
                    break;
                case 'AddonsPushedToAPI':
                    logSync('addons-push', 'Add-on collection sent to the account');
                    break;
                case 'AddonsPulledFromAPI': {
                    const changed = ((args && args.transport_urls) || []).length;
                    logSync('addons-pull', changed === 0 ?
                        'Add-on collection checked - already in sync' :
                        `Add-on collection updated (${count(changed, 'change')})`);
                    break;
                }
                case 'UserPulledFromAPI':
                    logSync('user-pull', 'Account details refreshed');
                    break;
                default:
                    break;
            }
        };
        const onError = (source: CoreEvent, error: CoreEventError) => {
            const event = source && source.event;
            const watched: Record<string, string> = {
                UserAuthenticated: 'Connecting to Stremio failed',
                LibrarySyncWithAPIPlanned: 'Library sync failed',
                LibraryItemsPushedToAPI: 'Sending library items failed',
                LibraryItemsPulledFromAPI: 'Fetching library items failed',
                AddonsPushedToAPI: 'Sending the add-on collection failed',
                AddonsPulledFromAPI: 'Fetching the add-on collection failed',
                UserPulledFromAPI: 'Refreshing account details failed',
            };
            if (event && watched[event]) {
                logSync('error', `${watched[event]}: ${(error && error.message) || 'unknown error'}`, true);
            }
        };
        core.on('event', onEvent);
        core.on('error', onError);
        return () => {
            core.off('event', onEvent);
            core.off('error', onError);
        };
    }, [core]);

    // Scheduler. Runs only while connected.
    useEffect(() => {
        if (!connected) return;
        const run = (reason: string) => {
            // Also swallows React StrictMode's dev double-mount, which fired
            // the launch run twice back to back.
            if (Date.now() - lastRunRef.current < 5000) return;
            lastRunRef.current = Date.now();
            logSync('autosync', `Sync started (${reason})`);
            core.transport.dispatch({ action: 'Ctx', args: { action: 'SyncLibraryWithAPI' } });
            core.transport.dispatch({ action: 'Ctx', args: { action: 'PullAddonsFromAPI' } });
            core.transport.dispatch({ action: 'Ctx', args: { action: 'PullUserFromAPI', args: {} } });
        };
        // Fires on mount when already connected (app launch) AND on the
        // anonymous->connected transition (right after Connect); this run IS
        // the post-connect first sync, so the modal must not dispatch its own.
        run('session start');
        const interval = setInterval(() => run('scheduled'), SYNC_INTERVAL_MS);
        const onFocus = () => {
            if (Date.now() - lastRunRef.current >= FOCUS_THROTTLE_MS) run('focus');
        };
        window.addEventListener('focus', onFocus);
        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', onFocus);
        };
    }, [core, connected]);
};

export default useStremioSync;
