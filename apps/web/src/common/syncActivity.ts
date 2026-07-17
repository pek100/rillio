// Persistent sync-activity log: every Stremio sync step (what the core actually
// did, translated from its events in common/useStremioSync) is appended here so
// "did the sync work?" is answerable from the UI, not from devtools. Capped
// ring, newest first, per profile (routed through profileStorage).

import { getItem, setItem } from 'rillio/common/profileStorage';

const KEY = 'rillio.syncLog';
const EVENT = 'rillio:sync-activity';
const MAX_ENTRIES = 100;

export type SyncLogEntry = {
    ts: number;
    kind: string;
    message: string;
    error?: boolean;
};

export const readSyncLog = (): SyncLogEntry[] => {
    const raw = getItem(KEY);
    if (raw === null) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const logSync = (kind: string, message: string, error = false): void => {
    const entry: SyncLogEntry = { ts: Date.now(), kind, message, ...(error ? { error: true } : {}) };
    const log = [entry, ...readSyncLog()].slice(0, MAX_ENTRIES);
    setItem(KEY, JSON.stringify(log));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: entry }));
};

/** Newest successful data-moving sync step, or null. */
export const lastSyncedAt = (): number | null => {
    const entry = readSyncLog().find((e) => !e.error &&
        ['library-push', 'library-pull', 'library-plan', 'addons-push', 'addons-pull'].includes(e.kind));
    return entry ? entry.ts : null;
};

/** Subscribe to new log entries (returns the unsubscribe). */
export const onSyncActivity = (listener: () => void): (() => void) => {
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
};
